import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { BookingStatus, NotificationType, StayParty } from "@repo/contracts";
import { type FakeNotificationService } from "../../notification/testing/notification-service.fakes";
import { cents } from "../../payment/domain/money";
import type { BookingEarlyEndService } from "./booking-early-end.service";
import type { BookingCancellationService } from "./booking-cancellation.service";
import type { BookingPaymentHandler } from "./booking-payment.handler";
import type { BookingService } from "./booking.service";
import { createBookingTestbed, payForStay } from "./testing/booking.fakes";
import { type FakeBookingCancellationRepository } from "./testing/booking-cancellation-repository.fakes";
import {
  admin,
  AMOUNT,
  fromToday,
  guest,
  LISTING_ID,
  GUEST_ID,
  owner,
  OWNER_ID,
  stranger,
} from "./testing/booking-fixtures.fakes";
import { type FakeBookingJobs } from "./testing/booking-jobs.fakes";
import { type FakeBookingRepository } from "./testing/booking-repository.fakes";
import { type FakeBookingTable } from "./testing/booking-table.fakes";
import { type FakePaymentGateway } from "./testing/payment-gateway.fakes";
import { type FakeStayEventsListener } from "./testing/stay-events.fakes";
import { type FakeWaitlistService } from "./testing/waitlist-service.fakes";

/**
 * What one night of the fake's stays costs: its three nights share the `AMOUNT` it charged,
 * since the refund is measured by nights that add up to what was paid.
 */
const NIGHT = cents(AMOUNT / 3);

/**
 * The terms every early end below is confirmed for: the stay's page states tomorrow, and no
 * refund — a refund larger than stated is no reason to refuse, so this one is never refused
 * for its refund.
 */
const TOMORROW = { checkOut: fromToday(1), refundCents: cents(0) };

/**
 * Ending a stay early against the fakes of `testing/booking.fakes.ts`. The fake's stays are
 * three nights of `NIGHT` each; the refund job runs at once, so what the
 * early end decided is read off the gateway's refunds.
 */
describe("BookingEarlyEndService", () => {
  let service: BookingService;
  let earlyEndService: BookingEarlyEndService;
  let cancellationService: BookingCancellationService;
  let paymentHandler: BookingPaymentHandler;
  let bookingTable: FakeBookingTable;
  let bookingRepository: FakeBookingRepository;
  let bookingCancellationRepository: FakeBookingCancellationRepository;
  let bookingJobs: FakeBookingJobs;
  let waitlistService: FakeWaitlistService;
  let notificationService: FakeNotificationService;
  let paymentGateway: FakePaymentGateway;
  let stayEventsListener: FakeStayEventsListener;

  /** A three-night stay `guest` paid for, starting `days` from today. */
  const paidStay = (days: number): Promise<string> =>
    payForStay({ service, paymentHandler }, days);

  const row = (id: string) => bookingTable.rows.get(id)?.booking;

  beforeEach(async () => {
    ({
      service,
      earlyEndService,
      cancellationService,
      paymentHandler,
      bookingTable,
      bookingRepository,
      bookingCancellationRepository,
      bookingJobs,
      waitlistService,
      notificationService,
      paymentGateway,
      stayEventsListener,
    } = await createBookingTestbed());
  });

  it("checks out tomorrow and refunds the nights after tonight under the cancellation's key", async () => {
    const id = await paidStay(0);

    await earlyEndService.endEarly(id, guest, {
      checkOut: fromToday(1),
      refundCents: cents(2 * NIGHT),
    });

    expect(row(id)).toMatchObject({
      status: BookingStatus.CONFIRMED,
      to: fromToday(1),
      refundOwedCents: null,
      refundedAmountCents: cents(2 * NIGHT),
    });
    expect(row(id)?.endedEarlyAt).not.toBeNull();
    expect(paymentGateway.refunds.get(`booking-${id}-cancellation`)).toEqual({
      paymentId: expect.any(String) as string,
      amount: cents(2 * NIGHT),
    });
    expect(stayEventsListener.settled).toEqual([
      { bookingId: id, refunded: cents(2 * NIGHT) },
    ]);
    expect(waitlistService.freed).toEqual([
      { listingId: LISTING_ID, from: fromToday(1), to: fromToday(3) },
    ]);
  });

  /** The early-end notices, by recipient, from here on. */
  const endedNotices = () =>
    notificationService.notices
      .filter(
        ({ content }) => content.type === NotificationType.STAY_ENDED_EARLY,
      )
      .map(({ userId, content }) => ({ userId, data: content.data }));

  it("tells the host when the guest ends the stay, and both sides when an admin does", async () => {
    const byGuest = await paidStay(0);

    await earlyEndService.endEarly(byGuest, guest, TOMORROW);

    expect(endedNotices()).toEqual([
      {
        userId: OWNER_ID,
        data: expect.objectContaining({
          bookingId: byGuest,
          to: fromToday(3),
          checkOut: fromToday(1),
          recipient: StayParty.HOST,
          endedBy: "GUEST",
          refundCents: cents(2 * NIGHT),
        }) as unknown,
      },
    ]);

    notificationService.notices.length = 0;
    bookingRepository.listingPolicy = "FIRM";
    const byAdmin = await paidStay(10);
    const found = bookingTable.rows.get(byAdmin);

    if (found !== undefined) {
      found.booking.from = fromToday(-1);
      found.booking.to = fromToday(3);
    }

    await earlyEndService.endEarly(byAdmin, admin, TOMORROW);

    expect(
      endedNotices().map(({ userId, data }) => ({
        userId,
        data: { ...data, bookingId: undefined },
      })),
    ).toEqual([
      expect.objectContaining({
        userId: GUEST_ID,
        data: expect.objectContaining({
          recipient: StayParty.GUEST,
          endedBy: "ADMIN",
          refundCents: 0,
        }) as unknown,
      }),
      expect.objectContaining({
        userId: OWNER_ID,
        data: expect.objectContaining({ recipient: StayParty.HOST }) as unknown,
      }),
    ]);
  });

  it("refunds the last night alone on the night before it", async () => {
    const id = await paidStay(-1);

    await earlyEndService.endEarly(id, admin, TOMORROW);

    expect(row(id)?.to).toBe(fromToday(1));
    expect(row(id)?.refundedAmountCents).toBe(NIGHT);
  });

  it("takes the policy's share of the unused nights", async () => {
    bookingRepository.listingPolicy = "MODERATE";
    const id = await paidStay(0);

    await earlyEndService.endEarly(id, guest, TOMORROW);

    expect(row(id)?.refundedAmountCents).toBe(NIGHT);
  });

  it("ends a stay whose policy keeps the unused nights without a refund", async () => {
    bookingRepository.listingPolicy = "FIRM";
    const id = await paidStay(0);

    await earlyEndService.endEarly(id, guest, TOMORROW);

    expect(row(id)).toMatchObject({
      to: fromToday(1),
      refundOwedCents: null,
      refundedAmountCents: null,
    });
    expect(bookingJobs.refunds).toEqual([]);
  });

  it("refuses the host, and a stranger as if the stay were not there", async () => {
    const id = await paidStay(0);
    // The payment's news took the lease already.
    const leases = [...bookingCancellationRepository.leases];

    await expect(
      earlyEndService.endEarly(id, owner, TOMORROW),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      earlyEndService.endEarly(id, stranger, TOMORROW),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(bookingCancellationRepository.leases).toEqual(leases);
    expect(row(id)?.to).toBe(fromToday(3));
  });

  it("refuses a stay not begun: that is a cancellation", async () => {
    const id = await paidStay(1);

    await expect(
      earlyEndService.endEarly(id, guest, TOMORROW),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(paymentGateway.refunds.size).toBe(0);
  });

  it("refuses a stay on its check-in day before the check-in time on the listing's clock", async () => {
    // 23:59 in Honolulu (UTC−10) on today's UTC date is 09:59 UTC tomorrow: still ahead.
    bookingRepository.listingTimeZone = "Pacific/Honolulu";
    bookingRepository.listingCheckInTime = "23:59";
    const id = await paidStay(0);

    await expect(earlyEndService.endEarly(id, guest, TOMORROW)).rejects.toThrow(
      "The stay has not begun yet",
    );
    expect(row(id)?.endedEarlyAt).toBeNull();

    // A cancellation is what the stay still takes.
    await cancellationService.remove(id, guest);
    expect(row(id)?.status).toBe(BookingStatus.CANCELLED);
  });

  it("refuses a stay on its last night: nothing is left after tonight", async () => {
    const id = await paidStay(-2);

    await expect(
      earlyEndService.endEarly(id, guest, TOMORROW),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(row(id)?.endedEarlyAt).toBeNull();
  });

  it("refunds once when pressed twice, and says the stay was ended already", async () => {
    const id = await paidStay(0);

    await earlyEndService.endEarly(id, guest, TOMORROW);
    await expect(earlyEndService.endEarly(id, guest, TOMORROW)).rejects.toThrow(
      new ConflictException(
        `This stay has been ended early already — it checks out on ${fromToday(1)}`,
      ),
    );
    expect(paymentGateway.refunds.size).toBe(1);
  });

  it("counts a refund Stripe holds whose news has not arrived as spread over every night", async () => {
    const id = await paidStay(0);
    const paymentId = bookingTable.rows.get(id)?.paymentId ?? "";

    // A dashboard refund of a quarter of the fixture's 48000 leaves 36000, and the two
    // unused nights keep 32000 × 36000 / 48000 of their worth.
    expect(AMOUNT).toBe(48_000);
    paymentGateway.refundedUnreported.set(paymentId, cents(12_000));

    await earlyEndService.endEarly(id, guest, TOMORROW);

    expect(paymentGateway.refunds.get(`booking-${id}-cancellation`)).toEqual({
      paymentId,
      amount: cents(24_000),
    });
  });

  it("refuses a refund that has shrunk since it was stated, ending nothing", async () => {
    const id = await paidStay(0);
    const paymentId = bookingTable.rows.get(id)?.paymentId ?? "";

    // The page stated the two unused nights whole; a dashboard refund of a quarter of the
    // charge whose news has not arrived leaves them 24000 of it.
    paymentGateway.refundedUnreported.set(paymentId, cents(12_000));

    await expect(
      earlyEndService.endEarly(id, guest, {
        checkOut: fromToday(1),
        refundCents: cents(2 * NIGHT),
      }),
    ).rejects.toThrow(/refund has changed.*240\.00/);
    expect(row(id)).toMatchObject({
      to: fromToday(3),
      endedEarlyAt: null,
      refundOwedCents: null,
    });
    expect(paymentGateway.refunds.size).toBe(0);

    await earlyEndService.endEarly(id, guest, {
      checkOut: fromToday(1),
      refundCents: cents(24_000),
    });

    expect(row(id)?.to).toBe(fromToday(1));
  });

  it("ends nothing when Stripe cannot be reached to read the refunds", async () => {
    const id = await paidStay(0);

    paymentGateway.refusing = true;

    await expect(
      earlyEndService.endEarly(id, guest, TOMORROW),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(row(id)).toMatchObject({
      to: fromToday(3),
      endedEarlyAt: null,
      refundOwedCents: null,
    });
  });

  it("refuses a stay whose cancellation key has a refund already", async () => {
    const id = await paidStay(0);
    const paymentId = bookingTable.rows.get(id)?.paymentId ?? "";

    paymentGateway.refunds.set(`booking-${id}-cancellation`, {
      paymentId,
      amount: cents(NIGHT),
    });

    await expect(
      earlyEndService.endEarly(id, guest, TOMORROW),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(row(id)?.endedEarlyAt).toBeNull();
  });

  it("refuses a disputed payment even when its policy keeps the unused nights", async () => {
    bookingRepository.listingPolicy = "FIRM";
    const id = await paidStay(0);
    const found = bookingTable.rows.get(id);

    if (found !== undefined) found.booking.dispute = "OPEN";

    await expect(
      earlyEndService.endEarly(id, guest, TOMORROW),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(row(id)?.to).toBe(fromToday(3));
  });

  it("refuses a disputed payment it would refund, and refunds nothing of a lost one", async () => {
    const disputed = await paidStay(0);
    const open = bookingTable.rows.get(disputed);

    if (open !== undefined) open.booking.dispute = "OPEN";

    await expect(
      earlyEndService.endEarly(disputed, guest, TOMORROW),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(row(disputed)?.to).toBe(fromToday(3));

    if (open !== undefined) open.booking.dispute = "LOST";

    await earlyEndService.endEarly(disputed, guest, TOMORROW);

    expect(row(disputed)).toMatchObject({
      to: fromToday(1),
      refundOwedCents: null,
    });
    expect(paymentGateway.refunds.size).toBe(0);
  });

  it("refuses a confirmation stated for a day that has passed, ending nothing", async () => {
    const id = await paidStay(-1);

    await expect(
      earlyEndService.endEarly(id, guest, {
        checkOut: fromToday(0),
        refundCents: cents(0),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(row(id)).toMatchObject({ to: fromToday(2), endedEarlyAt: null });
    expect(paymentGateway.refunds.size).toBe(0);
  });

  it("says the day turned when it turned onto the stay's last night", async () => {
    const id = await paidStay(-2);

    await expect(
      earlyEndService.endEarly(id, guest, {
        checkOut: fromToday(0),
        refundCents: cents(0),
      }),
    ).rejects.toThrow(/day has turned.*last night/);
    expect(row(id)?.endedEarlyAt).toBeNull();
  });

  it("answers a lease another request holds with a 409", async () => {
    const id = await paidStay(0);

    bookingCancellationRepository.held.add(id);

    await expect(
      earlyEndService.endEarly(id, guest, TOMORROW),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
