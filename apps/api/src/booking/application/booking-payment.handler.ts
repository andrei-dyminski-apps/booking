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
import type { ConfirmedStay, RefundTarget } from "../domain/booking.types";
import { BookingRepository } from "../infrastructure/booking.repository";
import { RefundFailureRepository } from "../infrastructure/refund-failure.repository";
import { StayLifecycle } from "./stay-lifecycle";
import { notifyBothSides } from "./stay-notices";

/** What the stays make of the provider's news. Idempotent, because a failed event runs again. */
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
      // An open dispute changes only what the host is owed: the payout side's.
      case "disputed":
      case "account":
      case "other":
        break;
    }
  }

  /**
   * Confirms the hold, or refunds a payment for nights no longer the guest's. A booking this
   * payment confirmed already refunds nothing even if cancelled since — the cancellation
   * refunded it by its own rule. Under `whileCancelling`, so two runs tell both sides once.
   */
  private async settlePayment(
    event: Extract<PaymentEvent, { kind: "succeeded" }>,
  ): Promise<void> {
    const { bookingId, paymentId } = event;

    // Another site's on the same account, or `stripe trigger`'s: not this API's to refund.
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

    if (target?.paid === true && target.hold.paymentId === paymentId) {
      if (
        target.status === BookingStatus.CONFIRMED &&
        !target.confirmationAnnounced
      ) {
        await this.announceConfirmed(target.hold);
      }

      return;
    }

    if (target !== null && target.refundedAmount !== null) return;

    await this.paymentGateway.refund(
      paymentId,
      event.amount,
      `payment-${paymentId}-unheld`,
    );
    this.logger.log(
      `Refunded payment ${paymentId}: booking ${bookingId} no longer holds its nights`,
    );

    // The booking may be gone with the guest's account; the money still went back.
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
   * A cancellation's own refund is recorded by its job under the same lease, so whatever
   * this raises is the dashboard's, and the guest is told.
   */
  private async settleRefund(
    event: Extract<PaymentEvent, { kind: "refunded" }>,
  ): Promise<void> {
    const { amountRefunded, paymentId } = event;
    const found = await this.bookingRepository.findRefundTarget(paymentId);

    // A late payment or `stripe trigger`'s: no stay was confirmed with it.
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

  /** A stay under way or over stays as the record of nights spent. */
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
   * The money is still the guest's, so the stay keeps recording it as refunded — which also
   * keeps the host's share without it — and a person re-sends it.
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
   * Whether this run raised the total. Lost to another writer, a total still short throws,
   * so the event is read anew rather than a notice sized off a stale reading.
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

  private async cancelStay(stay: RefundTarget, why: string): Promise<void> {
    if (
      (await this.bookingRepository.cancel(
        stay.bookingId,
        BookingStatus.CONFIRMED,
        // The money went back already: nothing is owed.
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

  /** Marked done last, so a run that dies before that repeats it. */
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
