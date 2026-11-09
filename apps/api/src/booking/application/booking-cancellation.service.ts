import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  BookingStatus,
  Canceller,
  DisputeStatus,
  HOST_CANCELLATIONS_THRESHOLD,
  HOST_REASON_REQUIRED,
  hostCancellationFee,
  isCancellableOn,
  notRefunded,
  NotificationType,
  refundQuote,
  type Booking,
  type CancelBookingInput,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { toIsoDate } from "../../common/iso-date";
import { NotificationService } from "../../notification/notification.service";
import { NO_CENTS, type Cents } from "../../payment/domain/money";
import { WaitlistService } from "../../waitlist/waitlist.service";
import { CancellationInProgressError } from "../domain/booking.errors";
import { isCancellable } from "../domain/booking-status";
import type {
  BookingWithListingOwner,
  CancellationBy,
  CancelledStay,
} from "../domain/booking.types";
import { BookingRepository } from "../infrastructure/booking.repository";
import { BookingCancellationRepository } from "../infrastructure/booking-cancellation.repository";
import { BookingJobs } from "./ports/booking-jobs";
import {
  notifyBothSidesOfCancellation,
  stayNoticeOf,
  type CancellationNotice,
} from "./stay-notices";
import { readerOf } from "./stay-reader";

/**
 * The cancellation of a stay: who may cancel it and on what terms, the refund it owes and
 * the host's fee, both written with `CANCELLED`, and the news of it. The refund is decided
 * here and queued; `BookingRefundService` sends it. It sees neither Prisma, Stripe nor
 * BullMQ — the repositories and the `BookingJobs` port — and calls no payment provider.
 */
@Injectable()
export class BookingCancellationService {
  private readonly logger = new Logger(BookingCancellationService.name);

  constructor(
    private readonly bookingRepository: BookingRepository,
    private readonly bookingCancellationRepository: BookingCancellationRepository,
    private readonly bookingJobs: BookingJobs,
    private readonly notificationService: NotificationService,
    private readonly waitlistService: WaitlistService,
  ) {}

  /**
   * The guest's decision, the host's and an admin's: a stranger may not even read the stay
   * (`404`). A host has to say why (`400` without a reason), refunds the guest in full under
   * any policy and pays a fee for a paid stay, written with the cancellation. The refund is
   * decided here and written with `CANCELLED` (`refund_owed_cents`); a job sends it, so a
   * slow Stripe slows a refund, not the answer.
   */
  async remove(
    id: string,
    user: AuthenticatedUser,
    input: CancelBookingInput = {},
  ): Promise<void> {
    const { canceller, booking: read } = await this.mayCancel(id, user);
    const reason = input.reason ?? null;

    // Before the lease, but only for a row that could be cancelled: one that cannot answers
    // its own `404` or `409` under the lease, and neither ever becomes cancellable again.
    if (
      canceller === Canceller.HOST &&
      reason === null &&
      read.endedEarlyAt === null &&
      isCancellableOn(read, toIsoDate(new Date()))
    ) {
      throw new BadRequestException(HOST_REASON_REQUIRED);
    }
    const { found, wasHold, cancelled, refundOwedCents, refundCents } =
      await this.bookingCancellationRepository
        .whileCancelling(id, () =>
          this.cancelReadable(id, user, canceller, reason),
        )
        .catch((error: unknown) => {
          if (error instanceof CancellationInProgressError) {
            throw new ConflictException(
              "The booking is being cancelled by another request — try again",
            );
          }

          throw error;
        });
    const { booking, listingOwnerId } = found;

    await this.bookingJobs.cancelExpiry(id);

    // The payment the cancelled row named, so one attached a moment ago goes too. Queued:
    // nobody who let a hold go should wait on Stripe for it.
    if (wasHold && cancelled.paymentId !== null) {
      await this.bookingJobs.withdrawPayment(cancelled.paymentId);
    }

    if (refundOwedCents !== null) {
      await this.bookingJobs.refundCancellation(id);
    }

    await this.notifyCancellation(booking, listingOwnerId, user, {
      refundCents,
      currency: booking.currency,
      cancelledBy: canceller,
      reason,
    });

    if (cancelled.fee !== null) {
      await this.notifyHostFee(booking, listingOwnerId, cancelled.fee);
    }

    await this.waitlistService.announceFreed([booking]);
  }

  /**
   * Who is cancelling, and the row as it was read. Everybody who may read a stay may cancel
   * it, each on their own terms, so the canceller is the reader `readerOf` names — decided
   * by the one rule that answers the `404`, never by elimination after it.
   */
  private async mayCancel(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ canceller: Canceller; booking: Booking }> {
    const { found, reader } = readerOf(
      user,
      id,
      await this.bookingRepository.findByIdWithListingOwner(id),
    );

    return { canceller: reader, booking: found.booking };
  }

  private async cancelReadable(
    id: string,
    user: AuthenticatedUser,
    canceller: Canceller,
    reason: string | null,
  ): Promise<{
    found: BookingWithListingOwner;
    wasHold: boolean;
    cancelled: CancelledStay;
    refundOwedCents: Cents | null;
    refundCents: Cents | null;
  }> {
    const found = await this.getReadable(id, user);
    const { booking } = found;

    if (!isCancellable(booking.status)) {
      throw new NotFoundException(`Booking ${id} not found`);
    }

    // An early end has spent the refund key a cancellation would send under
    // (`booking-<id>-cancellation`), so a second debt there would be read as already sent.
    // Today `isCancellableOn` refuses such a stay anyway — it has begun — but the two rules
    // are measured from different moments once check-in has a time of its own (7.6).
    if (booking.endedEarlyAt !== null) {
      throw new ConflictException(
        "A stay that was ended early can no longer be cancelled",
      );
    }

    const now = new Date();

    // The same day for everybody: once the stay has begun, nobody lets it go.
    if (!isCancellableOn(booking, toIsoDate(now))) {
      throw new ConflictException(
        "A stay that has begun can no longer be cancelled",
      );
    }

    const wasHold = booking.status === BookingStatus.PENDING_PAYMENT;
    const refundCents = this.refundOnCancel(found, canceller, now);
    // The debt the job sends; a refund of nothing is announced but never owed.
    const refundOwedCents =
      refundCents !== null && refundCents > 0 ? refundCents : null;
    const fee =
      canceller === Canceller.HOST
        ? hostCancellationFee(booking, now).cents
        : NO_CENTS;
    const by: CancellationBy = {
      canceller,
      reason,
      feeCents: fee > 0 ? fee : null,
    };
    const cancelled = await this.bookingCancellationRepository.cancel(
      id,
      booking.status,
      refundOwedCents,
      by,
    );

    if (cancelled === null) return this.refuseChangedCancellation(id);

    return { found, wasHold, cancelled, refundOwedCents, refundCents };
  }

  /** Still active means the hold was paid for in between: a `409` worth retrying. */
  private async refuseChangedCancellation(id: string): Promise<never> {
    const now = await this.bookingRepository.findByIdWithListingOwner(id);

    if (now !== null && isCancellable(now.booking.status)) {
      throw new ConflictException(
        "The booking changed while it was being cancelled — try again",
      );
    }

    throw new NotFoundException(`Booking ${id} not found`);
  }

  /**
   * What cancelling this stay gives back, decided once for the debt the cancellation writes
   * and for what `BOOKING_CANCELLED` tells both sides: `null` when there is no money to
   * speak of — a hold had nothing to give, a lost dispute's money went back through the
   * bank, and a stay refunded in full before it was cancelled has nothing left, where "no
   * refund" would read as the guest losing money they already have — otherwise the amount,
   * nothing included. An open dispute is a `409`: Stripe refuses to refund a disputed
   * payment.
   */
  private refundOnCancel(
    { booking, paymentId }: BookingWithListingOwner,
    canceller: Canceller,
    now: Date,
  ): Cents | null {
    if (booking.status !== BookingStatus.CONFIRMED || paymentId === null) {
      return null;
    }

    if (booking.dispute === DisputeStatus.OPEN) {
      throw new ConflictException(
        "The payment of this stay is disputed with the bank — it can be cancelled once the dispute is settled",
      );
    }

    if (
      booking.dispute === DisputeStatus.LOST ||
      notRefunded(booking.amountCents, booking.refundedAmountCents) === NO_CENTS
    ) {
      return null;
    }

    // The stay's own policy, frozen when it was taken; what was refunded already comes off.
    return refundQuote(booking, now, canceller).cents;
  }

  /**
   * Both sides of the stay hear about a cancellation except the one who made it: a guest's
   * reaches the host, a host's the guest, an admin's both. Each is told which side of the
   * stay they are, because "your stay" and "a stay at your listing" are different news, and
   * who cancelled and why.
   */
  private async notifyCancellation(
    booking: Booking,
    listingOwnerId: string,
    canceller: AuthenticatedUser,
    notice: CancellationNotice,
  ): Promise<void> {
    await notifyBothSidesOfCancellation(
      this.notificationService,
      {
        stay: stayNoticeOf(booking),
        guestId: booking.guestId,
        listingOwnerId,
        notice,
      },
      canceller.id,
    );
  }

  /**
   * The host is told what their cancellation costs, and every admin once a host has
   * cancelled `HOST_CANCELLATIONS_THRESHOLD` paid stays within the window — on every
   * cancellation from then on, since each is news. Neither can fail the cancellation.
   */
  private async notifyHostFee(
    booking: Booking,
    hostId: string,
    fee: { id: string; amountCents: Cents },
  ): Promise<void> {
    await this.notificationService.notify(hostId, {
      type: NotificationType.HOST_CANCELLATION_FEE,
      data: {
        ...stayNoticeOf(booking),
        feeId: fee.id,
        amountCents: fee.amountCents,
        currency: booking.currency,
      },
    });

    let record: { name: string; cancellations: number } | null;

    try {
      record = await this.bookingCancellationRepository.hostCancellations(
        hostId,
        new Date(),
      );
    } catch (error) {
      this.logger.error(
        `Could not count the cancellations of host ${hostId}: ${String(error)}`,
      );

      return;
    }

    if (
      record === null ||
      record.cancellations < HOST_CANCELLATIONS_THRESHOLD
    ) {
      return;
    }

    await this.notificationService.notifyAdmins({
      type: NotificationType.HOST_CANCELLATIONS_THRESHOLD,
      data: {
        hostId,
        hostName: record.name,
        cancellations: record.cancellations,
      },
    });
  }

  /**
   * The row read again under the lease, by the rule `BookingService.getReadable` states: a
   * stay the caller may not read is a `404`, as if it were not there.
   */
  private async getReadable(
    id: string,
    user: AuthenticatedUser,
  ): Promise<BookingWithListingOwner> {
    return readerOf(
      user,
      id,
      await this.bookingRepository.findByIdWithListingOwner(id),
    ).found;
  }
}
