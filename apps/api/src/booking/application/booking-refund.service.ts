import { Injectable, Logger } from "@nestjs/common";
import {
  bookingSchema,
  DisputeStatus,
  notRefunded,
  NotificationType,
  type StuckStayPage,
  type StuckStayQuery,
} from "@repo/contracts";
import { errorText, type SetAside } from "../../common/job-failure";
import { readCursor } from "../../common/paging";
import { writeOrRefuse } from "../../common/set-aside";
import {
  decodeSetAsideCursor,
  nextSetAsideCursor,
} from "../../common/set-aside-cursor";
import { NotificationService } from "../../notification/notification.service";
import { PaymentGateway } from "../../payment/application/ports/payment-gateway";
import {
  addCents,
  maxCents,
  minCents,
  NO_CENTS,
} from "../../payment/domain/money";
import { BookingRepository } from "../infrastructure/booking.repository";
import { BookingCancellationRepository } from "../infrastructure/booking-cancellation.repository";
import { BookingRefundRepository } from "../infrastructure/booking-refund.repository";
import { CancellationInProgressError } from "../domain/booking.errors";
import { owedOnStuck } from "../domain/stuck-stay";
import { BookingJobs } from "./ports/booking-jobs";
import { StayEvents } from "./stay-events";

/**
 * Sends the refunds cancellations owe: the job a cancellation queues, the sweep that retries
 * what is still owed, and the admin's list of what stopped retrying. Deciding the refund is
 * the cancellation's and stays in `BookingCancellationService`, which writes the debt and
 * queues the job — it never calls this class. A refund is announced to `StayEvents`, so the
 * host's payout follows without this module knowing of it.
 */
@Injectable()
export class BookingRefundService {
  private readonly logger = new Logger(BookingRefundService.name);

  constructor(
    private readonly bookingRepository: BookingRepository,
    private readonly bookingCancellationRepository: BookingCancellationRepository,
    private readonly bookingRefundRepository: BookingRefundRepository,
    private readonly paymentGateway: PaymentGateway,
    private readonly bookingJobs: BookingJobs,
    private readonly notificationService: NotificationService,
    private readonly stayEvents: StayEvents,
  ) {}

  /**
   * Under `whileCancelling`, so the refund's webhook reads it as this cancellation's. The
   * host's share is settled after, best effort — the refund's webhook settles it again.
   */
  async refundCancellation(id: string): Promise<boolean> {
    let refunded: boolean;

    try {
      refunded = await this.bookingCancellationRepository.whileCancelling(
        id,
        () => this.sendOwedRefund(id),
      );
    } catch (error) {
      // Held by another run: nothing failed yet.
      if (error instanceof CancellationInProgressError) throw error;

      if (await this.setAsideRefundAfter(id, error)) return false;

      throw error;
    }

    if (!refunded) return false;

    try {
      await this.stayEvents.refunded(id);
    } catch (error) {
      this.logger.warn(
        `Could not take back the payout of booking ${id} yet, the refund's webhook settles it: ${String(error)}`,
      );
    }

    return true;
  }

  /** One failure is logged and left for the next minute. */
  async refundOwedCancellations(): Promise<number> {
    let sent = 0;

    for (const id of await this.bookingRefundRepository.findOwedRefunds(
      SWEEP_BATCH,
    )) {
      try {
        if (await this.refundCancellation(id)) sent += 1;
      } catch (error) {
        // Taken by the refund job meanwhile: not a failure.
        if (error instanceof CancellationInProgressError) continue;

        this.logger.error(
          `Could not refund the cancellation of booking ${id}, trying again next sweep: ${String(error)}`,
        );
      }
    }

    return sent;
  }

  /**
   * The admin's list of the stays whose refund or payout stopped retrying. The payout's half
   * is read here too — its columns are on the stay — while its retry is `PayoutService`'s.
   */
  async findStuckPage(query: StuckStayQuery): Promise<StuckStayPage> {
    const resource = `bookings-stuck-${query.kind}`;
    const cursor = readCursor(query.cursor, "newest", (raw) =>
      decodeSetAsideCursor(resource, raw, bookingSchema.shape.id),
    );
    const page = await this.bookingRefundRepository.findStuckPage(
      query.kind,
      cursor,
      query.limit,
      query,
    );

    return {
      items: page.items.map(({ payout, ...row }) => ({
        ...row,
        owedCents: owedOnStuck(row.kind, row.booking, payout),
      })),
      nextCursor: nextSetAsideCursor(resource, page, (row) => ({
        at: row.failedAt,
        id: row.booking.id,
      })),
    };
  }

  /**
   * Hands the debt back and queues its job at once rather than waiting for the sweep. The
   * debt is still on the row, so the job sends exactly what the cancellation decided.
   */
  async retryStuckRefund(id: string): Promise<void> {
    await writeOrRefuse(
      this.bookingRefundRepository.handBackRefund(id),
      () => this.bookingRepository.exists(id),
      {
        conflict: `The refund owed on booking ${id} is not set aside`,
        notFound: `Booking ${id} not found`,
      },
    );

    this.logger.log(`The refund owed on booking ${id} was handed back`);
    await this.bookingJobs.refundCancellation(id);
  }

  /** Whether this failed run set the debt aside. A failure to count it leaves it to retry. */
  private async setAsideRefundAfter(
    id: string,
    error: unknown,
  ): Promise<boolean> {
    const message = errorText(error);
    let failure: SetAside | null;

    try {
      failure = await this.bookingRefundRepository.recordRefundFailure(
        id,
        message,
        MAX_REFUND_ATTEMPTS,
      );
    } catch (recordError) {
      this.logger.error(
        `Could not count the failed refund of booking ${id}: ${String(recordError)}`,
      );

      return false;
    }

    if (failure === null || !failure.setAside) return false;

    this.logger.error(
      `The refund owed on booking ${id} failed ${String(failure.attempts)} times and is set aside: ${message}`,
    );
    await this.notificationService.notifyAdmins({
      type: NotificationType.CANCELLATION_REFUND_FAILED,
      data: { bookingId: id, error: message },
    });

    return true;
  }

  /**
   * Capped by what Stripe says is left too, since a dashboard refund's webhook may be late.
   * The total recorded starts from the row: the rest is the dashboard's, and its webhook
   * tells the guest.
   */
  private async sendOwedRefund(id: string): Promise<boolean> {
    const found = await this.bookingRepository.findByIdWithListingOwner(id);
    const owed = found?.booking.refundOwedCents ?? null;

    if (found === null || owed === null) return false;

    const { booking, paymentId } = found;

    // Opened after the cancellation: Stripe refuses to refund a disputed payment, so the
    // debt waits for the outcome, which is when the sweep reads it again.
    if (booking.dispute === DisputeStatus.OPEN) return false;

    if (booking.dispute === DisputeStatus.LOST || paymentId === null) {
      await this.bookingRefundRepository.settleOwedRefund(id, null);

      return false;
    }

    const refundedBefore = booking.refundedAmountCents ?? NO_CENTS;
    const refundedAtProvider =
      await this.paymentGateway.refundedSoFar(paymentId);
    // Capped at the stay: whatever the provider reports, nothing past it is left to send.
    const amount = minCents(
      owed,
      notRefunded(
        booking.amountCents,
        maxCents(refundedBefore, refundedAtProvider),
      ),
    );

    if (amount === 0) {
      await this.bookingRefundRepository.settleOwedRefund(id, null);

      return false;
    }

    // One cancellation per booking, so the key needs no amount.
    const sent = await this.paymentGateway.refund(
      paymentId,
      amount,
      `booking-${id}-cancellation`,
    );

    await this.bookingRefundRepository.settleOwedRefund(
      id,
      sent > 0 ? addCents(refundedBefore, sent) : null,
    );

    return sent > 0;
  }
}

/**
 * How many failed runs set an owed refund aside: about half an hour of the minute sweep
 * after the job's own attempts, the bound the payment inbox keeps too.
 */
export const MAX_REFUND_ATTEMPTS = 30;

/**
 * How many owed refunds one sweep sends: each is a call or two to Stripe, one after another,
 * and the sweep a minute later takes the rest.
 */
const SWEEP_BATCH = 50;
