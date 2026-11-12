import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  DisputeStatus,
  isCancellableOn,
  refundableCents,
  type AdminRefundInput,
  type Booking,
  type BookingAdjustment,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import {
  PaymentGateway,
  RefundExceedsPaymentError,
  RefundRefusedError,
  type SentRefund,
} from "../../payment/application/ports/payment-gateway";
import {
  formatCents,
  maxCents,
  NO_CENTS,
  type Cents,
} from "../../payment/domain/money";
import { CancellationInProgressError } from "../domain/booking.errors";
import type { BookingWithListingOwner } from "../domain/booking.types";
import {
  BookingAdjustmentRepository,
  type AdjustmentClaim,
} from "../infrastructure/booking-adjustment.repository";
import { BookingCancellationRepository } from "../infrastructure/booking-cancellation.repository";
import { BookingRepository } from "../infrastructure/booking.repository";

/**
 * How long a press waits for a stay another run holds before its `409`. Shorter than a
 * cancellation's three seconds, because of what follows it inside the frontend's ten: a
 * second of waiting, the payment's refunds read (four seconds a page, a hundred refunds a
 * page — one page for any stay this site sells), the refund sent (four more), and a few
 * queries around them. A press past that budget is not lost — the transport gives up, the
 * dialog reads it as an unknown answer, and the claim makes the next press the same refund
 * — but it costs the admin a second press for a refund that went out.
 */
const LEASE_WAIT_MS = 1_000;

/**
 * How long a claimed press's own request may still be on its way to Stripe. The call gives
 * up after four seconds and Stripe may carry it out later, so a claim asked for more recently
 * than this is not released on the record's word: a refund landing after the release would be
 * one no row names. Measured from the claim's `attempted_at`, which every press that sends
 * `refundNow` again moves on — not from `created_at`: a press of an old claim sends a request
 * of its own, which may land just as late. Both ends are API clocks; a minute dwarfs the drift
 * between two instances. Stripe's own refusal releases a claim of any age — it answered
 * under the press's idempotency key, which a request still in flight would have been refused
 * under instead.
 */
const CLAIM_SETTLE_MS = 60_000;

/**
 * A part of a stay's payment an admin gives back without cancelling it — the hot water that
 * was off for two nights. The refund goes out while the admin waits, and its record is
 * written beside the stay; what follows is the provider's news, as for any refund:
 * `charge.refunded` raises the stay's refund total and tells the guest, and `StayEvents`
 * reaches the host's payout, which a refund after it reverses by the difference.
 */
@Injectable()
export class BookingAdjustmentService {
  private readonly logger = new Logger(BookingAdjustmentService.name);

  constructor(
    private readonly bookingRepository: BookingRepository,
    private readonly bookingCancellationRepository: BookingCancellationRepository,
    private readonly bookingAdjustmentRepository: BookingAdjustmentRepository,
    private readonly paymentGateway: PaymentGateway,
  ) {}

  /**
   * The caller is settled first, before the lease and before anything about the stay: an
   * account gone since its token is a `401`, one demoted or blocked since a `403`. Then
   * under the cancellation lease, which the refund job and the payment webhooks take too, so
   * the debt and the refund total it is measured against hold still while it is — waited for
   * `LEASE_WAIT_MS` rather than a cancellation's three seconds.
   */
  async refund(
    id: string,
    admin: AuthenticatedUser,
    input: AdminRefundInput,
  ): Promise<BookingAdjustment> {
    await this.assertActiveAdmin(admin.id);

    return this.bookingCancellationRepository
      .whileCancelling(
        id,
        () => this.refundLeased(id, admin, input),
        LEASE_WAIT_MS,
      )
      .catch((error: unknown) => {
        if (error instanceof CancellationInProgressError) {
          throw new ConflictException(
            "The booking is being refunded or cancelled by another request — try again",
          );
        }

        throw error;
      });
  }

  /** The refunds admins sent for the stay, newest first; `404` for a stay that is not there. */
  async listOf(id: string): Promise<BookingAdjustment[]> {
    if (!(await this.bookingRepository.exists(id))) {
      throw new NotFoundException(`Booking ${id} not found`);
    }

    return this.bookingAdjustmentRepository.listOf(id);
  }

  private async assertActiveAdmin(adminId: string): Promise<void> {
    switch (await this.bookingAdjustmentRepository.adminStanding(adminId)) {
      case "ACTIVE":
        return;
      case "GONE":
        throw new UnauthorizedException("Session no longer exists");
      case "NOT_ADMIN":
        throw new ForbiddenException("Your account is no longer an admin's");
    }
  }

  /**
   * A press already sent answers its row. One only claimed — the provider was asked, and
   * the answer never came back — goes on with the amount it was claimed for, and another is
   * a `409`: a second refund under one press is what the claim is there to rule out.
   *
   * The provider is read once (`findRefunds`) before anything is sent: the press's own
   * refund, found there, is recorded as the provider has it whatever a dispute or a webhook
   * did since; otherwise the stay is measured against the larger of its recorded refund total
   * and the provider's, so a refund whose webhook is late — an admin's a moment ago, the
   * dashboard's — counts. Without it, all that is left of a stay not yet begun could go back
   * in two presses, and `charge.refunded` would cancel the stay. An unclaimed press the record
   * alone refuses — an open dispute, more than is left — is refused before that read, and a
   * stay nobody paid for is refused with no call at all.
   *
   * The claim is written before `refundNow` and completed with its answer; a refusal of the
   * provider's deletes it, since nothing went out, and so does the record's — once Stripe was
   * last asked more than `CLAIM_SETTLE_MS` ago, before which that request may still land
   * there; a press sending it again stamps the claim first (`markAttempt`). A provider that
   * could not be reached leaves it for the press again; the stay's list shows it until then.
   */
  private async refundLeased(
    id: string,
    admin: AuthenticatedUser,
    { amountCents, reason, requestId }: AdminRefundInput,
  ): Promise<BookingAdjustment> {
    const found = await this.bookingRepository.findByIdWithListingOwner(id);

    if (found === null) throw new NotFoundException(`Booking ${id} not found`);

    const press = await this.bookingAdjustmentRepository.find(id, requestId);

    if (press?.status === "SENT") return press.adjustment;

    if (press !== null && press.amountCents !== amountCents) {
      throw new ConflictException(
        `This request went out for ${formatCents(press.amountCents)} already — press again with that amount, or open the dialog anew for another`,
      );
    }

    const { booking } = found;
    const paymentId = paidWith(found);
    const now = new Date();

    if (press === null) {
      const refusal = refusalOf(booking, NO_CENTS, amountCents, now);

      if (refusal !== null) throw refusal;
    }

    const key = adjustmentKey(id, requestId);
    const refunds = await this.askProvider(id, () =>
      this.paymentGateway.findRefunds(paymentId, key),
    );
    const claim: AdjustmentClaim = {
      bookingId: id,
      adminId: admin.id,
      requestId,
      amountCents,
      currency: booking.currency,
      reason,
    };

    if (refunds.sent !== null) return this.record(claim, refunds.sent);

    const refusal = refusalOf(booking, refunds.refunded, amountCents, now);

    if (refusal !== null) {
      if (
        press !== null &&
        Date.now() - press.attemptedAt.getTime() < CLAIM_SETTLE_MS
      ) {
        throw new ConflictException(
          "The first press of this refund may still be reaching Stripe — press again in a minute",
        );
      }

      await this.bookingAdjustmentRepository.release(id, requestId);

      throw refusal;
    }

    if (press === null) {
      await this.bookingAdjustmentRepository.claim(claim);
    } else {
      await this.bookingAdjustmentRepository.markAttempt(id, requestId);
    }

    const answer = await this.askProvider(id, () =>
      this.paymentGateway.refundNow(paymentId, amountCents, key).then(
        (sent): SentRefund | ConflictException => sent,
        (error: unknown) => {
          const refusedBy = providerRefusal(error);

          if (refusedBy === null) throw error;

          return refusedBy;
        },
      ),
    );

    if (answer instanceof ConflictException) {
      await this.bookingAdjustmentRepository.release(id, requestId);

      throw answer;
    }

    return this.record(claim, answer);
  }

  private record(
    claim: AdjustmentClaim,
    sent: SentRefund,
  ): Promise<BookingAdjustment> {
    this.logger.log(
      `Admin ${claim.adminId} refunded ${formatCents(sent.amount)} of booking ${claim.bookingId} (${sent.id})`,
    );

    return this.bookingAdjustmentRepository.record({
      ...claim,
      amountCents: sent.amount,
      refundId: sent.id,
    });
  }

  /** The provider's failures are a `502`. */
  private async askProvider<T>(id: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.error(`Could not refund booking ${id}: ${String(error)}`);

      throw new BadGatewayException("The refund could not be sent");
    }
  }
}

/**
 * Why the stay refuses the amount at `now`, or `null`: nothing while the bank holds the
 * payment in a dispute — Stripe refuses to refund a disputed payment, and the bank may give
 * the guest everything anyway — and at most what is left (`refundableCents`), counting the
 * larger of the recorded refund total and `refundedAtProvider`.
 */
function refusalOf(
  booking: Booking,
  refundedAtProvider: Cents,
  amount: AdminRefundInput["amountCents"],
  now: Date,
): ConflictException | null {
  if (booking.dispute === DisputeStatus.OPEN) {
    return new ConflictException(
      "The payment of this stay is disputed with the bank — it can be refunded once the dispute is settled",
    );
  }

  const left = refundableCents(
    {
      ...booking,
      refundedAmountCents: maxCents(
        booking.refundedAmountCents ?? NO_CENTS,
        refundedAtProvider,
      ),
    },
    now,
  );

  if (left === NO_CENTS) {
    return new ConflictException("Nothing of this stay is left to refund");
  }

  if (amount <= left) return null;

  return new ConflictException(
    isCancellableOn(booking, now)
      ? `At most ${formatCents(left)} of this stay is left to refund without cancelling it — refunding all of a stay not yet begun is cancelling it`
      : `At most ${formatCents(left)} of this stay is left to refund`,
  );
}

/**
 * Stripe's answer that it did not carry the refund out, as the `409` it is for the admin:
 * more than the charge has left — a refund went out between `findRefunds` and `refundNow`,
 * the dashboard's — or a refusal of its own, a dispute whose webhook has not arrived yet
 * among them. `null` for a failure that leaves the outcome unknown.
 */
function providerRefusal(error: unknown): ConflictException | null {
  if (error instanceof RefundExceedsPaymentError) {
    return new ConflictException(
      "Less of this stay is left to refund than that — another refund went out since",
    );
  }

  if (error instanceof RefundRefusedError) {
    return new ConflictException(`Stripe refused the refund: ${error.reason}`);
  }

  return null;
}

/** The payment a refund goes back through; a stay nobody paid for is a `409`. */
function paidWith({ booking, paymentId }: BookingWithListingOwner): string {
  if (!booking.paid || paymentId === null) {
    throw new ConflictException(
      "Nobody paid for this stay — there is nothing to refund",
    );
  }

  return paymentId;
}

/** One refund per press: the dialog mints the request, so a second press is the same refund. */
export function adjustmentKey(bookingId: string, requestId: string): string {
  return `booking-${bookingId}-adjustment-${requestId}`;
}
