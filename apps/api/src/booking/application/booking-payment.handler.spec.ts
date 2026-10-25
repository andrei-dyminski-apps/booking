import { randomUUID } from "node:crypto";
import { NotificationType, BookingStatus } from "@repo/contracts";
import { PaymentEventBusyError } from "../../payment/application/payment-event-handler";
import type { PaymentEvent } from "../../payment/application/ports/payment-gateway";
import { PaymentNotConfirmedYetError } from "../domain/booking.errors";
import type { BookingPaymentHandler } from "./booking-payment.handler";
import type { BookingService } from "./booking.service";
import {
  admin,
  AMOUNT,
  createBookingTestbed,
  fromToday,
  GUEST_ID,
  guest,
  input,
  LISTING_ID,
  OWNER_ID,
  payForStay,
  type FakeBookingRepository,
  type FakeNotificationService,
  type FakePaymentGateway,
  type FakeRefundFailureRepository,
  type FakeStayListener,
  type FakeWaitlistService,
} from "./testing/booking.fakes";

/**
 * What the stays make of the provider's news, in the module `BookingService` runs in — a
 * payment confirms a hold the service took, a refund lands on a stay it cancelled.
 */
describe("BookingPaymentHandler", () => {
  let service: BookingService;
  let bookingRepository: FakeBookingRepository;
  let notificationService: FakeNotificationService;
  let refundFailureRepository: FakeRefundFailureRepository;
  let waitlistService: FakeWaitlistService;
  let paymentGateway: FakePaymentGateway;
  let stayListener: FakeStayListener;
  let paymentHandler: BookingPaymentHandler;

  /** A booking `guest` took against a listing `owner` owns — the row every rule acts on. */
  const bookedByGuest = async (): Promise<string> =>
    (await service.create(GUEST_ID, input)).id;

  /** A stay `guest` has paid for, starting `days` from today. */
  const paidStay = (days: number): Promise<string> =>
    payForStay({ service, paymentHandler }, days);

  /** The notices of one type, in the order they were written. */
  const noticesOf = (type: NotificationType) =>
    notificationService.notices.filter(({ content }) => content.type === type);

  beforeEach(async () => {
    ({
      service,
      paymentHandler,
      bookingRepository,
      notificationService,
      refundFailureRepository,
      waitlistService,
      paymentGateway,
      stayListener,
    } = await createBookingTestbed());
  });

  describe("the payment of a hold", () => {
    const succeeded = (
      bookingId: string | null,
      paymentId = "pi_1",
      eventId = "evt_1",
    ): Extract<PaymentEvent, { kind: "succeeded" }> => ({
      kind: "succeeded",
      eventId,
      type: "payment_intent.succeeded",
      paymentId,
      chargeId: `ch_${paymentId}`,
      bookingId,
      amount: AMOUNT,
    });

    it("confirms the hold its payment names, and tells both sides", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await paymentHandler.handle(succeeded(id));

      expect(bookingRepository.rows.get(id)?.booking.status).toBe(
        BookingStatus.CONFIRMED,
      );
      expect(
        noticesOf(NotificationType.BOOKING_CONFIRMED).map(
          ({ userId }) => userId,
        ),
      ).toEqual([GUEST_ID, OWNER_ID]);
    });

    it("announces the stay it confirms to whoever follows the stays", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await paymentHandler.handle(succeeded(id));

      expect(stayListener.scheduled).toEqual([id]);
    });

    it("finishes what an earlier delivery of the same payment left undone, and refunds nothing", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      stayListener.refusingSchedule = true;

      // The first delivery dies after the confirmation committed and before anybody heard.
      await expect(paymentHandler.handle(succeeded(id))).rejects.toThrow();

      // The same news again, which the ledger never recorded. The state tells it apart
      // from a late payment.
      await paymentHandler.handle(succeeded(id, "pi_1", "evt_2"));

      expect(
        noticesOf(NotificationType.BOOKING_CONFIRMED).map(
          ({ userId }) => userId,
        ),
      ).toEqual([GUEST_ID, OWNER_ID]);
      expect(stayListener.scheduled).toEqual([id]);
      expect(paymentGateway.refunds.size).toBe(0);
    });

    it("tells nobody again when a delivery that finished comes once more", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      await paymentHandler.handle(succeeded(id));

      await paymentHandler.handle(succeeded(id, "pi_1", "evt_2"));

      expect(noticesOf(NotificationType.BOOKING_CONFIRMED)).toHaveLength(2);
      expect(stayListener.scheduled).toEqual([id]);
    });

    it("tells both sides once when two deliveries of one payment race", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await Promise.all([
        paymentHandler.handle(succeeded(id)),
        paymentHandler.handle(succeeded(id)),
      ]);

      expect(
        noticesOf(NotificationType.BOOKING_CONFIRMED).map(
          ({ userId }) => userId,
        ),
      ).toEqual([GUEST_ID, OWNER_ID]);
      expect(stayListener.scheduled).toEqual([id]);
    });

    it("confirms nothing with a payment of another sum, and gives it back", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await paymentHandler.handle({
        kind: "succeeded",
        eventId: "evt_1",
        type: "payment_intent.succeeded",
        paymentId: "pi_1",
        chargeId: "ch_pi_1",
        bookingId: id,
        amount: AMOUNT - 1,
      });

      expect(bookingRepository.rows.get(id)?.booking.status).toBe(
        BookingStatus.PENDING_PAYMENT,
      );
      expect([...paymentGateway.refunds.values()]).toEqual([
        { paymentId: "pi_1", amount: AMOUNT - 1 },
      ]);
    });

    it("gives back a payment that arrives for a hold no longer holding its nights", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      bookingRepository.lapsed.add(id);
      await service.releaseHold(id);

      await paymentHandler.handle(succeeded(id));

      const found = bookingRepository.rows.get(id);
      expect(found?.booking.status).toBe(BookingStatus.EXPIRED);
      expect(found?.booking.refundedAmount).toBe(AMOUNT);
      expect([...paymentGateway.refunds.values()]).toEqual([
        { paymentId: "pi_1", amount: AMOUNT },
      ]);
      const refunded = noticesOf(NotificationType.PAYMENT_REFUNDED);
      expect(refunded.map(({ userId }) => userId)).toEqual([GUEST_ID]);
      expect(refunded[0]?.content.data).toMatchObject({
        bookingId: id,
        amount: AMOUNT,
      });
    });

    it("throws when its refund fails, so the delivery comes again and finishes", async () => {
      const id = await bookedByGuest();
      await service.remove(id, guest);
      paymentGateway.refusing = true;

      await expect(paymentHandler.handle(succeeded(id))).rejects.toThrow();

      paymentGateway.refusing = false;
      await paymentHandler.handle(succeeded(id));

      expect(paymentGateway.refunds.size).toBe(1);
    });

    it("tells the guest about a late payment's refund once, however often it arrives", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      await service.remove(id, guest);

      await paymentHandler.handle(succeeded(id));
      // The same news under another event id, which the ledger has not seen.
      await paymentHandler.handle(succeeded(id, "pi_1", "evt_2"));

      expect(paymentGateway.refunds.size).toBe(1);
      expect(noticesOf(NotificationType.PAYMENT_REFUNDED)).toHaveLength(1);
    });

    it("records a payment that names no booking and touches nothing", async () => {
      await paymentHandler.handle(succeeded(null));

      expect(paymentGateway.refunds.size).toBe(0);
      expect(notificationService.notices).toEqual([]);
    });

    it("gives back nothing for a payment naming a booking this database does not hold", async () => {
      await paymentHandler.handle(succeeded(randomUUID()));

      expect(paymentGateway.refunds.size).toBe(0);
      expect(notificationService.notices).toEqual([]);
    });

    it("records no more than the stay costs when a payment of a larger sum goes back", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await paymentHandler.handle({ ...succeeded(id), amount: AMOUNT + 1 });

      // All of it goes back; the row's total is held to what the stay costs.
      expect([...paymentGateway.refunds.values()]).toEqual([
        { paymentId: "pi_1", amount: AMOUNT + 1 },
      ]);
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.PENDING_PAYMENT,
        refundedAmount: AMOUNT,
      });
    });

    it("gives back another payment naming the hold without confirming it or touching its refunds", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await paymentHandler.handle(succeeded(id, "pi_2", "evt_stray"));

      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.PENDING_PAYMENT,
        refundedAmount: null,
      });
      expect([...paymentGateway.refunds.entries()]).toEqual([
        ["payment-pi_2-unheld", { paymentId: "pi_2", amount: AMOUNT }],
      ]);
      expect(noticesOf(NotificationType.PAYMENT_REFUNDED)).toEqual([]);

      // The hold's own payment still confirms it.
      await paymentHandler.handle(succeeded(id));

      expect(bookingRepository.rows.get(id)?.booking.status).toBe(
        BookingStatus.CONFIRMED,
      );
    });

    it("hands a payment whose stay a cancellation holds back to the inbox as busy, not failed", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      bookingRepository.held.add(id);

      await expect(paymentHandler.handle(succeeded(id))).rejects.toBeInstanceOf(
        PaymentEventBusyError,
      );
      expect(bookingRepository.rows.get(id)?.booking.status).toBe(
        BookingStatus.PENDING_PAYMENT,
      );
    });
  });

  describe("a refund of a paid stay", () => {
    const refunded = (amountRefunded: number): PaymentEvent => ({
      kind: "refunded",
      eventId: `evt_refund_${String(amountRefunded)}`,
      type: "charge.refunded",
      paymentId: "pi_1",
      chargeId: "ch_pi_1",
      amountRefunded,
    });

    /** A confirmed stay, announced to the listener, with nothing else on record yet. */
    const paidHold = async (): Promise<string> => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      await paymentHandler.handle({
        kind: "succeeded",
        eventId: "evt_paid",
        type: "payment_intent.succeeded",
        paymentId: "pi_1",
        chargeId: "ch_pi_1",
        bookingId: id,
        amount: AMOUNT,
      });
      notificationService.notices.length = 0;

      return id;
    };

    it("cancels a stay not yet begun refunded in full from the dashboard, and frees its nights", async () => {
      const id = await paidStay(30);
      notificationService.notices.length = 0;

      await paymentHandler.handle(refunded(AMOUNT));

      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: AMOUNT,
      });
      expect(
        noticesOf(NotificationType.BOOKING_CANCELLED).map(
          ({ userId }) => userId,
        ),
      ).toEqual([GUEST_ID, OWNER_ID]);
      expect(waitlistService.freed).toEqual([
        { listingId: LISTING_ID, from: fromToday(30), to: fromToday(33) },
      ]);
      expect(stayListener.settled).toEqual([
        { bookingId: id, refunded: AMOUNT },
      ]);
    });

    it("keeps a stay under way refunded in full, still holding its nights", async () => {
      const id = await paidStay(0);
      notificationService.notices.length = 0;

      await paymentHandler.handle(refunded(AMOUNT));

      // The guest is in: the refund is recorded and told, the nights stay theirs.
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CONFIRMED,
        refundedAmount: AMOUNT,
      });
      expect(noticesOf(NotificationType.BOOKING_CANCELLED)).toEqual([]);
      expect(
        noticesOf(NotificationType.PAYMENT_REFUNDED).map(
          ({ userId }) => userId,
        ),
      ).toEqual([GUEST_ID]);
      expect(waitlistService.freed).toEqual([]);
      expect(stayListener.settled).toEqual([
        { bookingId: id, refunded: AMOUNT },
      ]);
    });

    it("keeps a refund the bank sent back on record, owed to the guest, and tells the admins once", async () => {
      const id = await paidHold();
      await paymentHandler.handle(refunded(100));
      notificationService.notices.length = 0;
      stayListener.settled.length = 0;

      const failed: PaymentEvent = {
        kind: "refundFailed",
        eventId: "evt_refund_failed",
        type: "refund.failed",
        paymentId: "pi_1",
        refundId: "re_1",
        amount: 100,
        reason: "expired_or_canceled_card",
      };

      await paymentHandler.handle(failed);
      // A redelivery of the same news.
      await paymentHandler.handle(failed);

      // Neither the guest's claim nor the host's share moves: a person issues it again.
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CONFIRMED,
        refundedAmount: 100,
      });
      expect(notificationService.notices).toEqual([]);
      expect(stayListener.settled).toEqual([]);

      const failure = {
        refundId: "re_1",
        paymentId: "pi_1",
        bookingId: id,
        amount: 100,
        reason: "expired_or_canceled_card",
      };

      expect([...refundFailureRepository.failures.values()]).toEqual([failure]);
      expect(notificationService.toAdmins).toEqual([
        { type: NotificationType.REFUND_FAILED, data: failure },
      ]);
    });

    it("tells the guest about a partial refund from the dashboard, and keeps the stay", async () => {
      const id = await paidHold();

      await paymentHandler.handle(refunded(100));

      expect(bookingRepository.rows.get(id)?.booking.status).toBe(
        BookingStatus.CONFIRMED,
      );
      const refunds = noticesOf(NotificationType.PAYMENT_REFUNDED);

      expect(refunds.map(({ userId }) => userId)).toEqual([GUEST_ID]);
      expect(refunds[0]?.content.data).toMatchObject({ amount: 100 });
    });

    it("tells the guest of two refunds reported at once what each gave back", async () => {
      const id = await paidHold();

      // The lease queues the two, so the second reads what the first wrote.
      await Promise.all([
        paymentHandler.handle(refunded(100)),
        paymentHandler.handle(refunded(150)),
      ]);

      expect(
        noticesOf(NotificationType.PAYMENT_REFUNDED).map(
          ({ content }) => content.data,
        ),
      ).toMatchObject([{ amount: 100 }, { amount: 50 }]);
      expect(bookingRepository.rows.get(id)?.booking.refundedAmount).toBe(150);
    });

    it("lets the payout side settle even a refund it has already seen", async () => {
      const id = await paidHold();

      await paymentHandler.handle(refunded(AMOUNT));
      await paymentHandler.handle(refunded(AMOUNT));

      expect(stayListener.settled).toEqual([
        { bookingId: id, refunded: AMOUNT },
        { bookingId: id, refunded: AMOUNT },
      ]);
      expect(bookingRepository.rows.get(id)?.booking.refundedAmount).toBe(
        AMOUNT,
      );
    });

    it("ignores the refund of a payment whose hold was let go unpaid", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      bookingRepository.lapsed.add(id);
      await service.releaseHold(id);

      await paymentHandler.handle(refunded(AMOUNT));

      expect(stayListener.settled).toEqual([]);
      expect(bookingRepository.rows.get(id)?.booking.refundedAmount).toBeNull();
    });

    it("has a refund that arrives before its payment's news come again, and then records it", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await expect(paymentHandler.handle(refunded(100))).rejects.toBeInstanceOf(
        PaymentNotConfirmedYetError,
      );
      expect(bookingRepository.rows.get(id)?.booking.refundedAmount).toBeNull();

      await paymentHandler.handle({
        kind: "succeeded",
        eventId: "evt_paid",
        type: "payment_intent.succeeded",
        paymentId: "pi_1",
        chargeId: "ch_pi_1",
        bookingId: id,
        amount: AMOUNT,
      });
      await paymentHandler.handle(refunded(100));

      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CONFIRMED,
        refundedAmount: 100,
      });
    });
  });

  describe("after a cancellation", () => {
    const cancellationRefunded: PaymentEvent = {
      kind: "refunded",
      eventId: "evt_cancellation",
      type: "charge.refunded",
      paymentId: "pi_1",
      chargeId: "ch_pi_1",
      amountRefunded: AMOUNT,
    };

    it("reads a cancellation's own refund as no news when its event comes", async () => {
      const id = await paidStay(30);

      await service.remove(id, guest);
      await paymentHandler.handle(cancellationRefunded);

      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: AMOUNT,
        refundOwed: null,
      });
      expect(
        noticesOf(NotificationType.BOOKING_CANCELLED).map(
          ({ userId }) => userId,
        ),
      ).toEqual([OWNER_ID]);
      expect(noticesOf(NotificationType.PAYMENT_REFUNDED)).toEqual([]);
    });

    it("tells the guest about a dashboard refund of a stay already cancelled", async () => {
      const id = await paidStay(1);
      await service.remove(id, guest);

      await paymentHandler.handle({
        kind: "refunded",
        eventId: "evt_dashboard",
        type: "charge.refunded",
        paymentId: "pi_1",
        chargeId: "ch_pi_1",
        amountRefunded: AMOUNT,
      });

      expect(bookingRepository.rows.get(id)?.booking.refundedAmount).toBe(
        AMOUNT,
      );
      expect(
        noticesOf(NotificationType.PAYMENT_REFUNDED).map(
          ({ userId, content }) => ({ userId, data: content.data }),
        ),
      ).toMatchObject([{ userId: GUEST_ID, data: { amount: AMOUNT } }]);
    });

    const disputeLost: PaymentEvent = {
      kind: "disputeClosed",
      eventId: "evt_dispute_lost",
      type: "charge.dispute.closed",
      paymentId: "pi_1",
      won: false,
    };

    it("cancels a stay not yet begun once its dispute is lost, and frees its nights", async () => {
      const id = await paidStay(30);

      await paymentHandler.handle(disputeLost);

      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: null,
      });
      expect(paymentGateway.refunds.size).toBe(0);
      expect(
        noticesOf(NotificationType.BOOKING_CANCELLED).map(
          ({ userId }) => userId,
        ),
      ).toEqual([GUEST_ID, OWNER_ID]);
      expect(waitlistService.freed).toHaveLength(1);
    });

    it("has a lost dispute that arrives before its payment's news come again", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await expect(paymentHandler.handle(disputeLost)).rejects.toBeInstanceOf(
        PaymentNotConfirmedYetError,
      );
      expect(bookingRepository.rows.get(id)?.booking.status).toBe(
        BookingStatus.PENDING_PAYMENT,
      );
    });

    it("keeps a stay already under way when its dispute is lost, or one whose dispute is won", async () => {
      const begun = await paidStay(0);

      await paymentHandler.handle(disputeLost);
      await paymentHandler.handle({ ...disputeLost, won: true });

      expect(bookingRepository.rows.get(begun)?.booking.status).toBe(
        BookingStatus.CONFIRMED,
      );
      expect(noticesOf(NotificationType.BOOKING_CANCELLED)).toEqual([]);
    });

    it("cancels the stay even when the host's payout cannot be taken back yet", async () => {
      const id = await paidStay(1);
      stayListener.refusing = true;

      await service.remove(id, admin);

      expect(bookingRepository.rows.get(id)?.booking.status).toBe(
        BookingStatus.CANCELLED,
      );

      // The refund's own delivery settles it, and comes again until it can.
      await expect(
        paymentHandler.handle(cancellationRefunded),
      ).rejects.toThrow();
      stayListener.refusing = false;
      await paymentHandler.handle(cancellationRefunded);

      expect(stayListener.settled).toEqual([
        { bookingId: id, refunded: AMOUNT },
      ]);
    });

    it("refunds nothing more when a cancelled stay's payment is delivered again", async () => {
      const id = await paidStay(1);
      await service.remove(id, guest);

      // The confirming delivery again, under an id the ledger never recorded.
      await paymentHandler.handle({
        kind: "succeeded",
        eventId: "evt_redelivered",
        type: "payment_intent.succeeded",
        paymentId: "pi_1",
        chargeId: "ch_1",
        bookingId: id,
        amount: AMOUNT,
      });

      expect(paymentGateway.refunds.size).toBe(0);
      expect(noticesOf(NotificationType.PAYMENT_REFUNDED)).toEqual([]);
    });
  });
});
