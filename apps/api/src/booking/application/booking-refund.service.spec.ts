import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { BookingStatus, NotificationType, type Booking } from "@repo/contracts";
import {
  MAX_REFUND_ATTEMPTS,
  type BookingRefundService,
} from "./booking-refund.service";
import type { BookingPaymentHandler } from "./booking-payment.handler";
import type { BookingService } from "./booking.service";
import { createBookingTestbed, payForStay } from "./testing/booking.fakes";
import { AMOUNT, guest, LISTING_ID } from "./testing/booking-fixtures.fakes";
import { type FakeBookingJobs } from "./testing/booking-jobs.fakes";
import { type FakeBookingRefundRepository } from "./testing/booking-refund-repository.fakes";
import { type FakeBookingTable } from "./testing/booking-table.fakes";
import { type FakeNotificationService } from "./testing/notification-service.fakes";
import { type FakePaymentGateway } from "./testing/payment-gateway.fakes";
import { type FakeWaitlistService } from "./testing/waitlist-service.fakes";

/**
 * The refund a cancellation owes, once `BookingService` has written it: the job that sends
 * it, the sweep that retries it, and the admin's list of what was set aside. Built in the
 * same module as the cancellations — see `testing/booking.fakes.ts` — since every case
 * starts from one.
 */
describe("BookingRefundService", () => {
  let service: BookingService;
  let refundService: BookingRefundService;
  let bookingTable: FakeBookingTable;
  let bookingRefundRepository: FakeBookingRefundRepository;
  let bookingJobs: FakeBookingJobs;
  let notificationService: FakeNotificationService;
  let waitlistService: FakeWaitlistService;
  let paymentGateway: FakePaymentGateway;
  let paymentHandler: BookingPaymentHandler;

  /** A stay `guest` has paid for, starting `days` from today. */
  const paidStay = (days: number): Promise<string> =>
    payForStay({ service, paymentHandler }, days);

  beforeEach(async () => {
    ({
      service,
      refundService,
      paymentHandler,
      bookingTable,
      bookingRefundRepository,
      bookingJobs,
      notificationService,
      waitlistService,
      paymentGateway,
    } = await createBookingTestbed());
  });

  it("cancels at once and owes the refund until the job sends it", async () => {
    const id = await paidStay(30);
    bookingJobs.worker = null;

    await service.remove(id, guest);

    expect(bookingTable.rows.get(id)).toMatchObject({
      booking: {
        status: BookingStatus.CANCELLED,
        refundedAmountCents: null,
        refundOwedCents: AMOUNT,
      },
    });
    expect(paymentGateway.refunds.size).toBe(0);
    expect(bookingJobs.refunds).toEqual([id]);
    expect(waitlistService.freed).toHaveLength(1);

    await expect(refundService.refundCancellation(id)).resolves.toBe(true);
    // A second run — the sweep racing the job — finds nothing owed.
    await expect(refundService.refundCancellation(id)).resolves.toBe(false);

    expect(paymentGateway.refunds.size).toBe(1);
    expect(bookingTable.rows.get(id)).toMatchObject({
      booking: { refundedAmountCents: AMOUNT, refundOwedCents: null },
    });
  });

  it("cancels when the refund cannot be issued yet, and the sweep sends it later", async () => {
    const id = await paidStay(30);
    paymentGateway.refusing = true;

    await service.remove(id, guest);

    expect(bookingJobs.failedRefunds).toHaveLength(1);
    expect(bookingTable.rows.get(id)).toMatchObject({
      booking: { status: BookingStatus.CANCELLED, refundOwedCents: AMOUNT },
    });

    // Still refused: logged and left for the next minute, not thrown out of the sweep.
    await expect(refundService.refundOwedCancellations()).resolves.toBe(0);

    paymentGateway.refusing = false;

    await expect(refundService.refundOwedCancellations()).resolves.toBe(1);
    expect(bookingTable.rows.get(id)).toMatchObject({
      booking: { refundedAmountCents: AMOUNT, refundOwedCents: null },
    });
  });

  it("sets a refund Stripe keeps refusing aside and tells the admins", async () => {
    const id = await paidStay(30);
    bookingJobs.worker = null;
    await service.remove(id, guest);
    paymentGateway.refusing = true;

    for (let run = 1; run < MAX_REFUND_ATTEMPTS; run += 1) {
      await expect(refundService.refundCancellation(id)).rejects.toThrow();
    }

    expect(notificationService.toAdmins).toEqual([]);

    // The last attempt ends the job's retries instead of failing it once more.
    await expect(refundService.refundCancellation(id)).resolves.toBe(false);
    expect(notificationService.toAdmins).toEqual([
      {
        type: NotificationType.CANCELLATION_REFUND_FAILED,
        data: { bookingId: id, error: expect.any(String) as string },
      },
    ]);
    // Still owed, and left to a person: the sweep no longer reads it.
    expect(bookingTable.rows.get(id)?.booking.refundOwedCents).toBe(AMOUNT);
    await expect(bookingRefundRepository.findOwedRefunds(50)).resolves.toEqual(
      [],
    );
  });

  describe("a refund set aside", () => {
    /** A cancellation whose refund Stripe refused until it was set aside. */
    const stuckRefund = async (days: number): Promise<string> => {
      const id = await paidStay(days);
      bookingJobs.worker = null;
      await service.remove(id, guest);
      paymentGateway.refusing = true;

      for (let run = 1; run <= MAX_REFUND_ATTEMPTS; run += 1) {
        await refundService.refundCancellation(id).catch(() => undefined);
      }

      paymentGateway.refusing = false;

      return id;
    };

    it("is listed for an admin with the stay, the attempts and the error", async () => {
      const id = await stuckRefund(30);
      await paidStay(31);

      const page = await refundService.findStuckPage({
        kind: "refund",
        limit: 20,
      });

      expect(page.items).toEqual([
        expect.objectContaining({
          kind: "refund",
          booking: expect.objectContaining({ id }) as Booking,
          owedCents: AMOUNT,
          attempts: MAX_REFUND_ATTEMPTS,
        }),
      ]);
      expect(page.nextCursor).toBeNull();
      await expect(
        refundService.findStuckPage({ kind: "payout", limit: 20 }),
      ).resolves.toEqual({ items: [], nextCursor: null });
    });

    it("pages by a cursor of its own kind", async () => {
      const older = await stuckRefund(30);
      const newer = await stuckRefund(31);

      const first = await refundService.findStuckPage({
        kind: "refund",
        limit: 1,
      });
      const cursor = first.nextCursor ?? undefined;
      const second = await refundService.findStuckPage({
        kind: "refund",
        limit: 1,
        cursor,
      });

      expect(first.items.map(({ booking }) => booking.id)).toEqual([newer]);
      expect(second.items.map(({ booking }) => booking.id)).toEqual([older]);
      expect(second.nextCursor).toBeNull();
      // A place among the stuck refunds names none among the stuck payouts.
      await expect(
        refundService.findStuckPage({ kind: "payout", limit: 1, cursor }),
      ).rejects.toThrow(BadRequestException);
    });

    it("is handed back on an admin's word and sent by the job it queues", async () => {
      const id = await stuckRefund(30);
      bookingJobs.worker = (bookingId) =>
        refundService.refundCancellation(bookingId);

      await refundService.retryStuckRefund(id);

      expect([...paymentGateway.refunds.values()]).toEqual([
        { paymentId: "pi_1", amount: AMOUNT },
      ]);
      expect(bookingTable.rows.get(id)).toMatchObject({
        booking: { refundedAmountCents: AMOUNT, refundOwedCents: null },
      });
      await expect(
        refundService.findStuckPage({ kind: "refund", limit: 20 }),
      ).resolves.toEqual({ items: [], nextCursor: null });
    });

    it("refuses a retry of a refund not set aside, and of a stay that is not there", async () => {
      const id = await paidStay(30);

      await expect(refundService.retryStuckRefund(id)).rejects.toThrow(
        ConflictException,
      );
      await expect(refundService.retryStuckRefund(LISTING_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  it("reads the debts that failed least first, so one that keeps failing cannot block the rest", async () => {
    const failing = await paidStay(30);
    bookingJobs.worker = null;
    await service.remove(failing, guest);
    await bookingRefundRepository.recordRefundFailure(failing, "refused", 99);

    const fresh = await paidStay(31);
    await service.remove(fresh, guest);

    await expect(bookingRefundRepository.findOwedRefunds(1)).resolves.toEqual([
      fresh,
    ]);
  });

  it("keeps a refund owed while a dispute opened after the cancellation is open", async () => {
    const id = await paidStay(30);
    bookingJobs.worker = null;
    await service.remove(id, guest);
    const found = bookingTable.rows.get(id);

    if (found !== undefined) found.booking.dispute = "OPEN";

    await expect(refundService.refundOwedCancellations()).resolves.toBe(0);
    expect(paymentGateway.refunds.size).toBe(0);
    expect(found?.booking.refundOwedCents).toBe(AMOUNT);

    // Won: the money is still the platform's, and it goes back as the cancellation said.
    if (found !== undefined) found.booking.dispute = "WON";

    await expect(refundService.refundOwedCancellations()).resolves.toBe(1);
    expect(found?.booking.refundedAmountCents).toBe(AMOUNT);
  });

  it("drops a refund owed once a dispute opened after the cancellation is lost", async () => {
    const id = await paidStay(30);
    bookingJobs.worker = null;
    await service.remove(id, guest);
    const found = bookingTable.rows.get(id);

    if (found !== undefined) found.booking.dispute = "LOST";

    await expect(refundService.refundOwedCancellations()).resolves.toBe(0);
    expect(paymentGateway.refunds.size).toBe(0);
    expect(found?.booking.refundOwedCents).toBeNull();
  });
});
