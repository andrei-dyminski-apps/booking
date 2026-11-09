import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from "@nestjs/common";
import {
  BookingStatus,
  Canceller,
  DisputeStatus,
  earlyCheckOut,
  mayEndEarly,
  notRefunded,
  unusedNightsRefund,
  type Booking,
  type EndStayEarlyInput,
  type StayNotice,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { toIsoDate } from "../../common/iso-date";
import { NotificationService } from "../../notification/notification.service";
import { PaymentGateway } from "../../payment/application/ports/payment-gateway";
import {
  formatCents,
  maxCents,
  NO_CENTS,
  type Cents,
  type Currency,
} from "../../payment/domain/money";
import { WaitlistService } from "../../waitlist/waitlist.service";
import { CancellationInProgressError } from "../domain/booking.errors";
import type { BookingDetailWithListingOwner } from "../domain/booking.types";
import { BookingRepository } from "../infrastructure/booking.repository";
import { BookingCancellationRepository } from "../infrastructure/booking-cancellation.repository";
import { cancellationRefundKey } from "./booking-refund.service";
import { BookingJobs } from "./ports/booking-jobs";
import { notifyBothSidesOfEarlyEnd, stayNoticeOf } from "./stay-notices";
import { readerOf } from "./stay-reader";

/**
 * Ending a stay early: the guest leaves before the check-out they paid for, and the nights
 * from tomorrow's on are given back at the stay's policy (`unusedNightsRefund`). The stay
 * stays `CONFIRMED`, its check-out moves, and the refund is a debt on the row that the
 * cancellation's job sends — under the same key, `booking-<id>-cancellation`, which is safe
 * because a cancellation happens only before check-in and an early end only after it, so one
 * booking never has both. The host's side needs nothing of its own: `owedToHost` counts the
 * debt as refunded, and `settle` reverses what was paid out beyond it.
 */
@Injectable()
export class BookingEarlyEndService {
  private readonly logger = new Logger(BookingEarlyEndService.name);

  constructor(
    private readonly bookingRepository: BookingRepository,
    private readonly bookingCancellationRepository: BookingCancellationRepository,
    private readonly bookingJobs: BookingJobs,
    private readonly paymentGateway: PaymentGateway,
    private readonly notificationService: NotificationService,
    private readonly waitlistService: WaitlistService,
  ) {}

  /**
   * The guest's decision or an admin's on their behalf; the host may read the stay but not
   * end it (`403`) — a host who wants their guest gone has no button for it. A stranger is
   * the `404` of every read. Under `whileCancelling`, so the debt and the refund total hold
   * still against the refund job and the payment webhooks. `stated` is what the caller was
   * shown: a day turned since, or a refund that has shrunk since, is a `409`, never a night or
   * a cent less than stated.
   */
  async endEarly(
    id: string,
    user: AuthenticatedUser,
    stated: EndStayEarlyInput,
  ): Promise<void> {
    const { reader } = readerOf(
      user,
      id,
      await this.bookingRepository.findByIdWithListingOwner(id),
    );

    if (reader === Canceller.HOST) {
      throw new ForbiddenException(
        "Only the guest or an admin can end a stay early",
      );
    }

    const ended = await this.bookingCancellationRepository
      .whileCancelling(id, () => this.endReadable(id, user, stated))
      .catch((error: unknown) => {
        if (error instanceof CancellationInProgressError) {
          throw new ConflictException(
            "The booking is being changed by another request — try again",
          );
        }

        throw error;
      });

    if (ended.refundOwedCents !== null) {
      await this.bookingJobs.refundCancellation(id);
    }

    await this.notifyEnded(ended.notice, reader, user.id);
    await this.waitlistService.announceFreed([ended.freed]);
  }

  /**
   * Both sides of the stay hear, except whoever ended it: a guest's early end reaches the
   * host, an admin's both. Each is told which side they are, the new check-out and what the
   * unused nights give back. `notify` never throws, so neither can fail the early end.
   */
  private async notifyEnded(
    { stay, guestId, listingOwnerId, ...notice }: EndedNotice,
    endedBy: Canceller,
    actorId: string,
  ): Promise<void> {
    await notifyBothSidesOfEarlyEnd(
      this.notificationService,
      { stay, guestId, listingOwnerId, notice: { ...notice, endedBy } },
      actorId,
    );
  }

  private async endReadable(
    id: string,
    user: AuthenticatedUser,
    stated: EndStayEarlyInput,
  ): Promise<{
    refundOwedCents: Cents | null;
    freed: { listingId: string; from: string; to: string };
    notice: EndedNotice;
  }> {
    const { found } = readerOf(
      user,
      id,
      await this.bookingRepository.findDetailWithListingOwner(id),
    );
    const { booking, nights } = found;
    const today = toIsoDate(new Date());
    const checkOut = earlyCheckOut(today);
    const expectedCheckOut = stated.checkOut;

    if (!mayEndEarly(booking, today)) {
      throw new ConflictException(
        whyNotEndable(booking, today, expectedCheckOut),
      );
    }

    // What the unused nights cost is all the refund is measured by.
    if (nights.length === 0) {
      throw new ConflictException(
        "This stay was booked before its nights were recorded and cannot end early",
      );
    }

    // What the caller agreed to was stated for another day: tonight is another night, so the
    // stay would check out on another day and give back other than the dialog said.
    if (checkOut !== expectedCheckOut) {
      throw new ConflictException(
        expectedCheckOut < checkOut
          ? `The day has turned since the refund was stated — ending the stay now checks out on ${checkOut}; read the refund again`
          : `The refund was stated for checking out on ${expectedCheckOut}, but ending the stay now checks out on ${checkOut}; read the refund again`,
      );
    }

    // The stay as it was booked, before the write moves its check-out: the nights it frees
    // end at `to`, and the notice names the stay that was taken.
    const { to } = booking;
    const stay = stayNoticeOf(booking);
    const refundCents = await this.refundOnEnd(id, found, today);

    // A refund recorded since the page read the stay took its part of the unused nights: the
    // caller agreed to more than ending the stay gives back now. More than stated is not a
    // reason to refuse — the page may have read a refund the rule no longer counts.
    if ((refundCents ?? NO_CENTS) < stated.refundCents) {
      throw new ConflictException(
        `The refund has changed since it was stated: a refund the page had not read yet gave back part of the unused nights, and ending the stay now gives back ${formatCents(refundCents ?? NO_CENTS)} ${booking.currency} — read it again`,
      );
    }

    // The debt the job sends; a refund of nothing is announced but never owed.
    const owed = refundCents !== null && refundCents > 0 ? refundCents : null;
    const written = await this.bookingCancellationRepository.endEarly(
      id,
      to,
      checkOut,
      owed,
    );

    if (!written) {
      throw new ConflictException(
        "The booking changed while it was being ended — try again",
      );
    }

    return {
      refundOwedCents: owed,
      freed: {
        listingId: booking.listingId,
        from: checkOut,
        to,
      },
      notice: {
        stay,
        checkOut,
        refundCents,
        currency: booking.currency,
        guestId: booking.guestId,
        listingOwnerId: found.listingOwnerId,
      },
    };
  }

  /**
   * What ending the stay gives back, decided once for the debt and for the notice, by the
   * rules `refundOnCancel` keeps for a cancellation: `null` when there is no money to speak
   * of — a stay nobody paid, a lost dispute (the bank gave the money back), one refunded in
   * full already — otherwise `unusedNightsRefund`, nothing included. An open dispute is a
   * `409` whatever the share, as it is for a cancellation: the bank holds the payment, so the
   * stay's terms wait for the outcome, and the stay's page offers no button meanwhile.
   *
   * What was refunded is the larger of the row's total and Stripe's, read here under the
   * lease: a refund whose `charge.refunded` has not arrived yet — the dashboard's, an admin's
   * a moment ago — took its part of every night too, and the share of what is left is what
   * the rule gives back. The job caps by Stripe's total as well, but only at the payment, not
   * at the share. The same read finds a refund already sent under the key this debt will go
   * out under, which only a cancellation could have spent: that is a `409`, never a second
   * debt the job would read as sent.
   */
  private async refundOnEnd(
    id: string,
    { booking, paymentId, nights }: BookingDetailWithListingOwner,
    today: string,
  ): Promise<Cents | null> {
    if (!booking.paid || paymentId === null) return null;

    if (booking.dispute === DisputeStatus.OPEN) {
      throw new ConflictException(
        "The payment of this stay is disputed with the bank — it can be ended early once the dispute is settled",
      );
    }

    if (booking.dispute === DisputeStatus.LOST) return null;

    const provider = await this.askProvider(id, () =>
      this.paymentGateway.findRefunds(paymentId, cancellationRefundKey(id)),
    );

    if (provider.sent !== null) {
      throw new ConflictException(
        "A cancellation refund has been sent for this stay already — it cannot end early",
      );
    }

    const refunded = {
      ...booking,
      refundedAmountCents: maxCents(
        booking.refundedAmountCents ?? NO_CENTS,
        provider.refunded,
      ),
    };

    if (
      notRefunded(refunded.amountCents, refunded.refundedAmountCents) ===
      NO_CENTS
    ) {
      return null;
    }

    return unusedNightsRefund(refunded, nights, today).cents;
  }

  /** The provider's failures are a `502`; nothing has been written by then. */
  private async askProvider<T>(id: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.error(
        `Could not read the refunds of booking ${id} to end it early: ${String(error)}`,
      );

      throw new BadGatewayException(
        "The payment provider could not be reached — the stay was not ended, try again",
      );
    }
  }
}

/**
 * Why `mayEndEarly` refused, in the words of the case the caller is most likely in: a stay
 * ended early already — a second press, another tab — says so; a stay in progress whose day
 * turned under the dialog onto its last night says that, since the caller was right a moment
 * ago; anything else hears the rule.
 */
function whyNotEndable(
  booking: Booking,
  today: string,
  expectedCheckOut: string,
): string {
  if (booking.endedEarlyAt !== null) {
    return `This stay has been ended early already — it checks out on ${booking.to}`;
  }

  if (
    booking.status === BookingStatus.CONFIRMED &&
    booking.from <= today &&
    expectedCheckOut < earlyCheckOut(today)
  ) {
    return `The day has turned since the refund was stated, and tonight is now the stay's last night — it checks out on ${booking.to} as booked`;
  }

  return "Only a confirmed stay in progress with a night left after tonight can end early";
}

/** What `STAY_ENDED_EARLY` copies off the stay, and the two people it may go to. */
type EndedNotice = {
  stay: StayNotice;
  checkOut: string;
  refundCents: Cents | null;
  currency: Currency;
  guestId: string;
  listingOwnerId: string;
};
