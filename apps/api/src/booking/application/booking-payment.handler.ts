import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { BookingStatus, NotificationType } from "@repo/contracts";
import { NotificationService } from "../../notification/notification.service";
import { PaymentEventDispatcher } from "../../payment/application/payment-event-dispatcher";
import type { PaymentEventHandler } from "../../payment/application/payment-event-handler";
import {
  PaymentGateway,
  type PaymentEvent,
} from "../../payment/application/ports/payment-gateway";
import { roundCents } from "../../payment/domain/money";
import { toIsoDate } from "../../prisma/iso-date";
import { WaitlistService } from "../../waitlist/waitlist.service";
import {
  BookingRepository,
  type ConfirmedStay,
  type RefundTarget,
} from "../infrastructure/booking.repository";
import { RefundFailureRepository } from "../infrastructure/refund-failure.repository";
import { StayLifecycle } from "./stay-lifecycle";
import { notifyBothSides } from "./stay-notices";

/**
 * What the stays make of the payment provider's news: a payment that succeeded turns a hold
 * into a stay, a refund is recorded and, when it takes the whole payment back, ends the
 * stay, and a dispute lost ends a stay that has not begun. Registered with the dispatcher
 * when the module starts. Idempotent, because a failed event is handled again.
 */
@Injectable()
export class BookingPaymentHandler
  implements PaymentEventHandler, OnModuleInit
{
  private readonly logger = new Logger(BookingPaymentHandler.name);

  constructor(
    private readonly bookingRepository: BookingRepository,
    private readonly refundFailureRepository: RefundFailureRepository,
    private readonly paymentGateway: PaymentGateway,
    private readonly notificationService: NotificationService,
    private readonly waitlistService: WaitlistService,
    private readonly paymentEventDispatcher: PaymentEventDispatcher,
    private readonly stayLifecycle: StayLifecycle,
  ) {}

  onModuleInit(): void {
    this.paymentEventDispatcher.register(this);
  }

  async handle(event: PaymentEvent): Promise<void> {
    switch (event.kind) {
      case "succeeded":
        await this.settlePayment(event);
        break;
      case "refunded":
        await this.settleRefund(event);
        break;
      case "refundFailed":
        await this.reportFailedRefund(event);
        break;
      case "disputeClosed":
        if (!event.won) await this.settleLostDispute(event);
        break;
      // An open dispute changes only what the host is owed, which is the payout side's.
      case "disputed":
      case "account":
      case "other":
        break;
    }
  }

  /**
   * Confirms the hold, or refunds a payment that arrived for nights no longer the guest's
   * (the hold lapsed or was cancelled meanwhile). A booking this payment already confirmed
   * is a redelivery: it refunds nothing even if cancelled since — the cancellation refunded
   * it by its own rule — and repeats only the announcement a run that died may have missed.
   * All under `whileCancelling`, so two runs over one payment tell both sides once.
   */
  private async settlePayment(
    event: Extract<PaymentEvent, { kind: "succeeded" }>,
  ): Promise<void> {
    const { bookingId, paymentId } = event;

    // A payment this deployment never opened — another site's on the same account, or
    // `stripe trigger`'s. Nothing to settle, and nothing of it is this API's to refund.
    if (bookingId === null) {
      this.logger.warn(`Payment ${paymentId} names no booking, ignored`);

      return;
    }

    await this.bookingRepository.whileCancelling(bookingId, () =>
      this.confirmOrRefund(event, bookingId),
    );
  }

  private async confirmOrRefund(
    event: Extract<PaymentEvent, { kind: "succeeded" }>,
    bookingId: string,
  ): Promise<void> {
    const { paymentId } = event;
    const confirmed = await this.bookingRepository.confirmPayment(
      bookingId,
      paymentId,
      event.chargeId,
      event.amount,
    );

    if (confirmed !== null) {
      await this.announceConfirmed(confirmed);

      return;
    }

    const target = await this.bookingRepository.findPaymentTarget(bookingId);

    // Confirmed by an earlier delivery of the same news, whatever happened to the stay since.
    if (target?.paid === true && target.hold.paymentId === paymentId) {
      if (
        target.status === BookingStatus.CONFIRMED &&
        !target.confirmationAnnounced
      ) {
        await this.announceConfirmed(target.hold);
      }

      return;
    }

    // Given back by an earlier delivery, which died before the ledger recorded it.
    if (target !== null && target.refundedAmount !== null) return;

    // The gateway finds a refund already sent under this key, so a repeat sends nothing.
    await this.paymentGateway.refund(
      paymentId,
      event.amount,
      `payment-${paymentId}-unheld`,
    );
    this.logger.log(
      `Refunded payment ${paymentId}: booking ${bookingId} no longer holds its nights`,
    );

    // The guest's account may be gone, and the booking with it; the money still goes back.
    // Of two deliveries racing here, the one that records the refund is the one that tells.
    if (
      target !== null &&
      (await this.bookingRepository.recordRefund(bookingId, event.amount))
    ) {
      await this.notificationService.notify(target.hold.guestId, {
        type: NotificationType.PAYMENT_REFUNDED,
        data: { ...target.hold.stay, amount: event.amount },
      });
    }
  }

  /**
   * A charge was refunded: the stay records Stripe's total. A cancellation's own refund is
   * recorded by its job under the same lease before it lets go, so whatever this raises is
   * somebody else's — the dashboard's — and the guest is told. Refunded in full, a stay
   * still confirmed is cancelled. The host's share follows through `StayLifecycle`.
   */
  private async settleRefund(
    event: Extract<PaymentEvent, { kind: "refunded" }>,
  ): Promise<void> {
    const { amountRefunded, paymentId } = event;
    const found = await this.bookingRepository.findRefundTarget(paymentId);

    // A payment this API never confirmed a stay with: a late one is refunded by the webhook
    // itself and recorded there, and `stripe trigger` sends payments nobody opened.
    if (found === null || !found.paid) return;

    await this.bookingRepository.whileCancelling(found.bookingId, async () => {
      const stay = await this.bookingRepository.findRefundTarget(paymentId);

      if (stay === null) return;

      const before = stay.refundedAmount ?? 0;

      if (await this.raiseRefundTotal(event, stay)) {
        await this.notificationService.notify(stay.hold.guestId, {
          type: NotificationType.PAYMENT_REFUNDED,
          data: {
            ...stay.hold.stay,
            amount: roundCents(amountRefunded - before),
          },
        });
      }

      if (
        amountRefunded >= stay.amount &&
        stay.status === BookingStatus.CONFIRMED
      ) {
        await this.cancelStay(
          stay,
          `Booking ${stay.bookingId} was refunded in full and is cancelled`,
        );
      }
    });

    await this.stayLifecycle.refunded(found.bookingId);
  }

  /**
   * The bank decided a dispute for the guest: a stay not yet begun is cancelled like one
   * refunded in full; one under way or over stays as the record of nights spent.
   */
  private async settleLostDispute(
    event: Extract<PaymentEvent, { kind: "disputeClosed" }>,
  ): Promise<void> {
    const found = await this.bookingRepository.findRefundTarget(
      event.paymentId,
    );

    if (found === null || !found.paid) return;

    await this.bookingRepository.whileCancelling(found.bookingId, async () => {
      const stay = await this.bookingRepository.findRefundTarget(
        event.paymentId,
      );
      const today = toIsoDate(new Date());

      if (
        stay?.status === BookingStatus.CONFIRMED &&
        today < stay.hold.stay.from
      ) {
        await this.cancelStay(
          stay,
          `Booking ${stay.bookingId} lost its payment to a dispute and is cancelled`,
        );
      }
    });
  }

  /**
   * A refund the guest's bank sent back. The money is on the platform's balance but still
   * the guest's, so the stay keeps recording it as refunded — which also keeps the host's
   * share sized without it — and a person is asked to issue it again: the failure is kept in
   * `refund_failures` until they do, and every admin is told. Only the delivery that wrote
   * the row tells them, so a redelivery is news to nobody.
   */
  private async reportFailedRefund(
    event: Extract<PaymentEvent, { kind: "refundFailed" }>,
  ): Promise<void> {
    const stay = await this.bookingRepository.findRefundTarget(event.paymentId);
    const failure = {
      refundId: event.refundId,
      paymentId: event.paymentId,
      bookingId: stay?.bookingId ?? null,
      amount: event.amount,
      reason: event.reason,
    };

    if (!(await this.refundFailureRepository.record(failure))) return;

    this.logger.error(
      `Refund ${event.refundId} of ${String(event.amount)} on payment ${event.paymentId}` +
        ` (booking ${failure.bookingId ?? "unknown"}) failed: ${event.reason ?? "no reason given"}.` +
        " The money is back on the platform balance and still owed to the guest — issue it again by hand.",
    );
    await this.notificationService.notifyAdmins({
      type: NotificationType.REFUND_FAILED,
      data: failure,
    });
  }

  /**
   * Raises the stay's refund total to Stripe's from exactly what was read, and answers
   * whether this run did. Lost to another writer, a total already this high is somebody
   * else's news; one still short throws, so the event is read anew rather than a notice
   * sized off a stale reading.
   */
  private async raiseRefundTotal(
    { paymentId, amountRefunded }: Extract<PaymentEvent, { kind: "refunded" }>,
    stay: RefundTarget,
  ): Promise<boolean> {
    if (amountRefunded <= (stay.refundedAmount ?? 0)) return false;

    if (
      await this.bookingRepository.raiseRefunded(
        stay.bookingId,
        stay.refundedAmount,
        amountRefunded,
      )
    ) {
      return true;
    }

    const now = await this.bookingRepository.findRefundTarget(paymentId);

    if ((now?.refundedAmount ?? 0) >= amountRefunded) return false;

    throw new Error(
      `The refund total of booking ${stay.bookingId} moved while it was being raised`,
    );
  }

  /** A stay whose money went back is cancelled, and both sides are told. */
  private async cancelStay(stay: RefundTarget, why: string): Promise<void> {
    if (
      (await this.bookingRepository.cancel(
        stay.bookingId,
        BookingStatus.CONFIRMED,
        // The money has gone back already, by the dashboard or the bank: nothing is owed.
        null,
      )) === null
    ) {
      return;
    }

    this.logger.log(why);

    await notifyBothSides(
      this.notificationService,
      NotificationType.BOOKING_CANCELLED,
      stay.hold,
    );
    await this.waitlistService.announceFreed([stay.hold.stay]);
  }

  /**
   * A hold became a stay: the host's payout is scheduled, both sides are told, and the
   * announcement is marked done last — a run that dies before that repeats it.
   */
  private async announceConfirmed(confirmed: ConfirmedStay): Promise<void> {
    await this.stayLifecycle.confirmed(confirmed.stay);
    await notifyBothSides(
      this.notificationService,
      NotificationType.BOOKING_CONFIRMED,
      confirmed,
    );
    await this.bookingRepository.markConfirmationAnnounced(
      confirmed.stay.bookingId,
    );
  }
}
