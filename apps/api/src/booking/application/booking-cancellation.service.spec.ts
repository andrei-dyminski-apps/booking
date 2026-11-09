import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import {
  BookingStatus,
  NotificationType,
  Role,
  StayParty,
  type Booking,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { type FakeNotificationService } from "../../notification/testing/notification-service.fakes";
import { CURRENCY, cents, subtractCents } from "../../payment/domain/money";
import type { BookingCancellationService } from "./booking-cancellation.service";
import type { BookingPaymentHandler } from "./booking-payment.handler";
import type { BookingService } from "./booking.service";
import { createBookingTestbed, payForStay } from "./testing/booking.fakes";
import { type FakeBookingCancellationRepository } from "./testing/booking-cancellation-repository.fakes";
import {
  admin,
  AMOUNT,
  GUEST_ID,
  guest,
  input,
  LISTING_ID,
  owner,
  OWNER_ID,
  searchFor,
  stranger,
} from "./testing/booking-fixtures.fakes";
import { type FakeBookingJobs } from "./testing/booking-jobs.fakes";
import { type FakeBookingRepository } from "./testing/booking-repository.fakes";
import { type FakeBookingTable } from "./testing/booking-table.fakes";
import { type FakePaymentGateway } from "./testing/payment-gateway.fakes";
import { type FakeStayEventsListener } from "./testing/stay-events.fakes";
import { type FakeWaitlistService } from "./testing/waitlist-service.fakes";

/** A partial refund of a stay that costs `AMOUNT`, and what it leaves of the payment. */
const PART = cents(10_000);
const REST = subtractCents(AMOUNT, PART);

/**
 * The cancellation against fakes of its repositories, the gateway and a stay listener — see
 * `testing/booking.fakes.ts`. `BookingService` takes and pays for the stays the cases
 * cancel; how an owed refund is sent, retried and set aside is
 * `booking-refund.service.spec.ts`'s — the cases here run the refund job through to check
 * what a cancellation decided.
 */
describe("BookingCancellationService", () => {
  let service: BookingService;
  let cancellationService: BookingCancellationService;
  let bookingRepository: FakeBookingRepository;
  let bookingTable: FakeBookingTable;
  let bookingCancellationRepository: FakeBookingCancellationRepository;
  let bookingJobs: FakeBookingJobs;
  let notificationService: FakeNotificationService;
  let waitlistService: FakeWaitlistService;
  let paymentGateway: FakePaymentGateway;
  let stayEventsListener: FakeStayEventsListener;
  let paymentHandler: BookingPaymentHandler;

  /** A booking `guest` took against a listing `owner` owns — the row every rule acts on. */
  const bookedByGuest = async (): Promise<string> =>
    (await service.create(GUEST_ID, input)).id;

  /** A stay `guest` has paid for, starting `days` from today. */
  const paidStay = (days: number): Promise<string> =>
    payForStay({ service, paymentHandler }, days);

  /** The stays one caller is handed. */
  const seenBy = async (user: AuthenticatedUser): Promise<Booking[]> =>
    (await service.findPage(user, searchFor())).items;

  beforeEach(async () => {
    ({
      service,
      cancellationService,
      paymentHandler,
      bookingRepository,
      bookingTable,
      bookingCancellationRepository,
      bookingJobs,
      notificationService,
      waitlistService,
      paymentGateway,
      stayEventsListener,
    } = await createBookingTestbed());
  });

  it("lets the guest, an admin and the host with a reason cancel", async () => {
    const id = await bookedByGuest();

    // A host takes a stay away from its guest, who is owed a reason.
    await expect(cancellationService.remove(id, owner)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.findOne(id, owner)).resolves.toMatchObject({
      id,
      status: BookingStatus.PENDING_PAYMENT,
    });

    await cancellationService.remove(id, guest);
    expect(bookingJobs.cancelled).toContain(id);

    const second = await bookedByGuest();
    await cancellationService.remove(second, admin);

    const third = await bookedByGuest();
    await cancellationService.remove(third, owner, {
      reason: "The roof leaks",
    });

    await expect(seenBy(admin)).resolves.toHaveLength(3);
    await expect(service.findOne(third, guest)).resolves.toMatchObject({
      status: BookingStatus.CANCELLED,
      cancelledBy: "HOST",
      cancellationReason: "The roof leaks",
    });
  });

  // The lease would otherwise let anybody who knows an id keep the guest's own
  // cancellation and the refund's webhook waiting behind refused requests.
  it("takes the cancellation lease only for somebody who may cancel", async () => {
    const id = await bookedByGuest();

    await expect(cancellationService.remove(id, owner)).rejects.toThrow(
      BadRequestException,
    );
    await expect(cancellationService.remove(id, stranger)).rejects.toThrow(
      NotFoundException,
    );
    expect(bookingCancellationRepository.leases).toEqual([]);

    await cancellationService.remove(id, guest);
    expect(bookingCancellationRepository.leases).toEqual([id]);
  });

  it("tells the host when the guest cancels, and both sides when an admin does", async () => {
    const recipientsOfCancelling = async (
      canceller: AuthenticatedUser,
    ): Promise<{ userId: string; recipient: string }[]> => {
      const id = await bookedByGuest();

      notificationService.notices.length = 0;
      await cancellationService.remove(id, canceller);

      return notificationService.notices.map(({ userId, content }) => {
        if (content.type !== NotificationType.BOOKING_CANCELLED) {
          throw new Error(`Unexpected ${content.type}`);
        }

        return { userId, recipient: content.data.recipient };
      });
    };

    await expect(recipientsOfCancelling(guest)).resolves.toEqual([
      { userId: OWNER_ID, recipient: StayParty.HOST },
    ]);
    await expect(recipientsOfCancelling(admin)).resolves.toEqual([
      { userId: GUEST_ID, recipient: StayParty.GUEST },
      { userId: OWNER_ID, recipient: StayParty.HOST },
    ]);
  });

  it("tells nobody about a cancellation it refused", async () => {
    const id = await bookedByGuest();

    notificationService.notices.length = 0;
    await expect(cancellationService.remove(id, owner)).rejects.toThrow(
      BadRequestException,
    );

    expect(notificationService.notices).toEqual([]);
  });

  describe("the waitlist", () => {
    const nights = { listingId: LISTING_ID, from: input.from, to: input.to };

    it("hands it the nights a cancellation let go of", async () => {
      const id = await bookedByGuest();

      await cancellationService.remove(id, guest);

      expect(waitlistService.freed).toEqual([nights]);
    });

    it("hands it nothing for a cancellation it refused", async () => {
      const id = await bookedByGuest();

      await expect(cancellationService.remove(id, stranger)).rejects.toThrow(
        NotFoundException,
      );

      expect(waitlistService.freed).toEqual([]);
    });
  });

  describe("a host's cancellation", () => {
    const why = { reason: "A pipe burst" };

    it("refunds the guest in full under any policy, and costs the host the fee of its tier", async () => {
      // Nothing back for a guest inside the last week under FIRM; everything for the host's.
      bookingRepository.listingPolicy = "FIRM";
      const id = await paidStay(5);

      await cancellationService.remove(id, owner, why);

      expect([...paymentGateway.refunds.values()]).toEqual([
        { paymentId: "pi_1", amount: AMOUNT },
      ]);
      // 48 hours to 30 days before check-in: a quarter of the stay.
      expect(bookingCancellationRepository.hostFees.get(id)).toMatchObject({
        hostId: OWNER_ID,
        amountCents: AMOUNT / 4,
      });
    });

    it("costs a tenth a month ahead and half inside the last two days", async () => {
      const early = await paidStay(40);
      await cancellationService.remove(early, owner, why);

      expect(
        bookingCancellationRepository.hostFees.get(early)?.amountCents,
      ).toBe(AMOUNT / 10);

      const late = await paidStay(1);
      await cancellationService.remove(late, owner, why);

      expect(
        bookingCancellationRepository.hostFees.get(late)?.amountCents,
      ).toBe(AMOUNT / 2);
    });

    it("holds a host promoted to admin to a host's terms: a reason, and the fee", async () => {
      const id = await paidStay(40);
      const promoted = { ...owner, role: Role.ADMIN };

      await expect(cancellationService.remove(id, promoted)).rejects.toThrow(
        BadRequestException,
      );

      await cancellationService.remove(id, promoted, why);

      expect(bookingCancellationRepository.hostFees.get(id)?.amountCents).toBe(
        AMOUNT / 10,
      );
    });

    it("costs nothing for a hold nobody has paid for", async () => {
      const id = await bookedByGuest();

      await cancellationService.remove(id, owner, why);

      expect(bookingCancellationRepository.hostFees.size).toBe(0);
      expect(
        notificationService.notices.map(({ content }) => content.type),
      ).not.toContain(NotificationType.HOST_CANCELLATION_FEE);
    });

    it("tells the guest who cancelled and why, and the host what it costs", async () => {
      const id = await paidStay(40);

      notificationService.notices.length = 0;
      await cancellationService.remove(id, owner, why);

      expect(notificationService.notices).toEqual([
        {
          userId: GUEST_ID,
          content: expect.objectContaining({
            type: NotificationType.BOOKING_CANCELLED,
            data: expect.objectContaining({
              recipient: StayParty.GUEST,
              refundCents: AMOUNT,
              cancelledBy: "HOST",
              reason: why.reason,
            }) as unknown,
          }) as unknown,
        },
        {
          userId: OWNER_ID,
          content: expect.objectContaining({
            type: NotificationType.HOST_CANCELLATION_FEE,
            data: expect.objectContaining({
              bookingId: id,
              amountCents: AMOUNT / 10,
            }) as unknown,
          }) as unknown,
        },
      ]);
    });

    it("tells every admin from the third paid stay a host cancels", async () => {
      const thresholdNotices = () =>
        notificationService.toAdmins.filter(
          ({ type }) => type === NotificationType.HOST_CANCELLATIONS_THRESHOLD,
        );

      for (const days of [40, 50]) {
        await cancellationService.remove(await paidStay(days), owner, why);
      }

      expect(thresholdNotices()).toEqual([]);

      await cancellationService.remove(await paidStay(60), owner, why);

      expect(thresholdNotices()).toEqual([
        {
          type: NotificationType.HOST_CANCELLATIONS_THRESHOLD,
          data: { hostId: OWNER_ID, hostName: "Host", cancellations: 3 },
        },
      ]);
    });

    it("leaves a cancellation whose fee an admin waived out of the count", async () => {
      for (const days of [40, 50]) {
        await cancellationService.remove(await paidStay(days), owner, why);
      }

      const [waived] = bookingCancellationRepository.hostFees.values();

      if (waived !== undefined) waived.waived = true;

      await cancellationService.remove(await paidStay(60), owner, why);

      expect(
        notificationService.toAdmins.filter(
          ({ type }) => type === NotificationType.HOST_CANCELLATIONS_THRESHOLD,
        ),
      ).toEqual([]);
    });

    it("answers a host with no reason by the row first: a stay cancelled already is a 404", async () => {
      const id = await paidStay(40);

      await cancellationService.remove(id, guest);

      await expect(cancellationService.remove(id, owner)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("refuses the host once the stay has begun, as everybody else", async () => {
      const id = await paidStay(0);

      await expect(cancellationService.remove(id, owner, why)).rejects.toThrow(
        ConflictException,
      );
      expect(bookingCancellationRepository.hostFees.size).toBe(0);
    });
  });

  /**
   * A cancelled stay is a record, not a deletion — phase 6 refunds against it. So it keeps
   * answering its guest, with the status saying what happened and the deadline the hold
   * had still on it, and only a second cancellation is refused.
   */
  it("keeps the cancelled booking readable, and refuses to cancel it twice", async () => {
    const id = await bookedByGuest();
    const held = await service.findOne(id, guest);

    await cancellationService.remove(id, guest);

    await expect(service.findOne(id, guest)).resolves.toMatchObject({
      id,
      status: BookingStatus.CANCELLED,
      expiresAt: held.expiresAt,
    });
    await expect(cancellationService.remove(id, guest)).rejects.toThrow(
      NotFoundException,
    );
  });

  describe("cancelling", () => {
    it("refunds a guest in full inside the free window, by the job the cancellation queues", async () => {
      const id = await paidStay(30);

      await cancellationService.remove(id, guest);

      expect([...paymentGateway.refunds.entries()]).toEqual([
        [`booking-${id}-cancellation`, { paymentId: "pi_1", amount: AMOUNT }],
      ]);
      expect(bookingTable.rows.get(id)).toMatchObject({
        booking: {
          status: BookingStatus.CANCELLED,
          refundedAmountCents: AMOUNT,
        },
      });
    });

    it("records the refund an earlier attempt sent rather than sending another", async () => {
      const id = await paidStay(30);
      // Sent by a run whose answer was lost, for less than the stay — the key is what names it.
      paymentGateway.refunds.set(`booking-${id}-cancellation`, {
        paymentId: "pi_1",
        amount: PART,
      });

      await cancellationService.remove(id, guest);

      expect(paymentGateway.refunds.size).toBe(1);
      expect(bookingTable.rows.get(id)).toMatchObject({
        booking: { refundedAmountCents: PART, refundOwedCents: null },
      });
    });

    it("refunds a guest nothing once the window has closed", async () => {
      const id = await paidStay(1);

      await cancellationService.remove(id, guest);

      expect(paymentGateway.refunds.size).toBe(0);
      expect(bookingTable.rows.get(id)).toMatchObject({
        booking: { status: BookingStatus.CANCELLED, refundedAmountCents: null },
      });
    });

    it("refunds the share the stay's own policy gives, frozen when it was taken", async () => {
      // Half back from 14 days before check-in to 7 under LIMITED.
      bookingRepository.listingPolicy = "LIMITED";
      const id = await paidStay(10);
      // A change of the listing's policy afterwards does not restate the stay.
      bookingRepository.listingPolicy = "FLEXIBLE";

      await cancellationService.remove(id, guest);

      expect([...paymentGateway.refunds.values()]).toEqual([
        { paymentId: "pi_1", amount: AMOUNT / 2 },
      ]);
      expect(bookingTable.rows.get(id)).toMatchObject({
        booking: {
          cancellationPolicy: "LIMITED",
          status: BookingStatus.CANCELLED,
          refundedAmountCents: AMOUNT / 2,
        },
      });
    });

    it("tells the host what the guest's cancellation gives back", async () => {
      bookingRepository.listingPolicy = "LIMITED";
      const paid = await paidStay(10);

      notificationService.notices.length = 0;
      await cancellationService.remove(paid, guest);

      expect(notificationService.notices).toEqual([
        {
          userId: OWNER_ID,
          content: expect.objectContaining({
            type: NotificationType.BOOKING_CANCELLED,
            data: expect.objectContaining({
              refundCents: AMOUNT / 2,
              currency: CURRENCY,
            }) as unknown,
          }) as unknown,
        },
      ]);

      // A hold was never paid, so there is nothing to say about money.
      const hold = await bookedByGuest();

      notificationService.notices.length = 0;
      await cancellationService.remove(hold, guest);

      expect(notificationService.notices).toEqual([
        {
          userId: OWNER_ID,
          content: expect.objectContaining({
            data: expect.objectContaining({ refundCents: null }) as unknown,
          }) as unknown,
        },
      ]);
    });

    it("says nothing about money for a stay refunded in full before it was cancelled", async () => {
      const paid = await paidStay(30);
      const found = bookingTable.rows.get(paid);

      if (found === undefined) throw new Error("The stay was not stored");

      // Refunded in full outside the API, the news not acted on yet.
      found.booking.refundedAmountCents = AMOUNT;
      notificationService.notices.length = 0;
      await cancellationService.remove(paid, admin);

      expect(notificationService.notices).toEqual(
        [GUEST_ID, OWNER_ID].map((userId) => ({
          userId,
          content: expect.objectContaining({
            type: NotificationType.BOOKING_CANCELLED,
            data: expect.objectContaining({ refundCents: null }) as unknown,
          }) as unknown,
        })),
      );
    });

    it("refunds only what a dashboard refund left of the payment", async () => {
      const id = await paidStay(30);
      await paymentHandler.handle({
        kind: "refunded",
        eventId: "evt_dashboard",
        type: "charge.refunded",
        paymentId: "pi_1",
        chargeId: "ch_pi_1",
        amountRefunded: PART,
      });

      await cancellationService.remove(id, guest);

      expect([...paymentGateway.refunds.values()]).toEqual([
        { paymentId: "pi_1", amount: REST },
      ]);
      expect(bookingTable.rows.get(id)).toMatchObject({
        booking: {
          status: BookingStatus.CANCELLED,
          refundedAmountCents: AMOUNT,
        },
      });
      expect(stayEventsListener.settled.at(-1)).toEqual({
        bookingId: id,
        refunded: AMOUNT,
      });
    });

    it("refunds only what is left when a dashboard refund has not been reported yet", async () => {
      const id = await paidStay(30);
      paymentGateway.refundedUnreported.set("pi_1", PART);

      await cancellationService.remove(id, guest);

      expect([...paymentGateway.refunds.values()]).toEqual([
        { paymentId: "pi_1", amount: REST },
      ]);
      // The row counts its own refund only: the dashboard's is its webhook's to tell.
      expect(bookingTable.rows.get(id)).toMatchObject({
        booking: { status: BookingStatus.CANCELLED, refundedAmountCents: REST },
      });
    });

    it("keeps a dashboard refund on record when the cancellation refunds nothing", async () => {
      const id = await paidStay(1);
      await paymentHandler.handle({
        kind: "refunded",
        eventId: "evt_dashboard",
        type: "charge.refunded",
        paymentId: "pi_1",
        chargeId: "ch_pi_1",
        amountRefunded: PART,
      });

      await cancellationService.remove(id, guest);

      expect(bookingTable.rows.get(id)).toMatchObject({
        booking: { status: BookingStatus.CANCELLED, refundedAmountCents: PART },
      });
    });

    it("refuses to cancel a stay whose payment is disputed until the bank decides", async () => {
      const id = await paidStay(30);
      const found = bookingTable.rows.get(id);

      if (found !== undefined) found.booking.dispute = "OPEN";

      await expect(cancellationService.remove(id, admin)).rejects.toThrow(
        ConflictException,
      );
      expect(paymentGateway.refunds.size).toBe(0);
      expect(found?.booking.status).toBe(BookingStatus.CONFIRMED);
    });

    it("cancels a stay whose dispute was lost without refunding it again", async () => {
      const id = await paidStay(30);
      const found = bookingTable.rows.get(id);

      if (found !== undefined) found.booking.dispute = "LOST";

      await cancellationService.remove(id, admin);

      expect(paymentGateway.refunds.size).toBe(0);
      expect(found?.booking.status).toBe(BookingStatus.CANCELLED);
    });

    it("refunds an admin's cancellation in full after the free window", async () => {
      const id = await paidStay(1);

      await cancellationService.remove(id, admin);

      expect(bookingTable.rows.get(id)?.booking.refundedAmountCents).toBe(
        AMOUNT,
      );
    });

    it("refunds a guest promoted to admin by their stay's policy, not in full", async () => {
      // Nothing back inside the last week under FIRM, whatever the guest's role now.
      bookingRepository.listingPolicy = "FIRM";
      const id = await paidStay(1);

      await cancellationService.remove(id, { ...guest, role: Role.ADMIN });

      expect(paymentGateway.refunds.size).toBe(0);
      expect(bookingTable.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        cancelledBy: "GUEST",
      });
    });

    it("refuses the guest and an admin alike once the stay has begun", async () => {
      const id = await paidStay(0);

      await expect(
        cancellationService.remove(id, guest),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        cancellationService.remove(id, admin),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(bookingTable.rows.get(id)?.booking.status).toBe(
        BookingStatus.CONFIRMED,
      );
      expect(paymentGateway.refunds.size).toBe(0);
    });

    it("refuses a stay ended early whatever its dates: its refund key is spent", async () => {
      const id = await paidStay(1);
      const found = bookingTable.rows.get(id);

      // Unreachable while both rules count UTC days; check-in at a time of its own (7.6)
      // would let a cancellation follow an early end on the check-in day.
      if (found !== undefined) {
        found.booking.endedEarlyAt = new Date().toISOString();
      }

      await expect(
        cancellationService.remove(id, guest),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(found?.booking.status).toBe(BookingStatus.CONFIRMED);
      expect(paymentGateway.refunds.size).toBe(0);
    });

    it("takes the host's share of a cancellation's refund back once it is sent", async () => {
      const id = await paidStay(1);

      await cancellationService.remove(id, admin);

      expect(stayEventsListener.settled).toEqual([
        { bookingId: id, refunded: AMOUNT },
      ]);
    });

    it("settles nothing for a cancellation that refunds nothing", async () => {
      const id = await paidStay(1);

      await cancellationService.remove(id, guest);

      expect(stayEventsListener.settled).toEqual([]);
    });

    it("leaves a hold paid for mid-cancellation confirmed, and asks for another try", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      bookingTable.racing = async (racedId) => {
        bookingTable.racing = null;
        await bookingRepository.confirmPayment(racedId, "pi_1", null, AMOUNT);
      };

      await expect(cancellationService.remove(id, guest)).rejects.toThrow(
        ConflictException,
      );
      expect(bookingTable.rows.get(id)?.booking.status).toBe(
        BookingStatus.CONFIRMED,
      );
      expect(bookingJobs.withdrawals).toEqual([]);
    });

    it("withdraws a payment a payment page opened while the hold was being cancelled", async () => {
      const id = await bookedByGuest();
      bookingTable.racing = async () => {
        bookingTable.racing = null;
        await service.payment(id, guest);
      };

      await cancellationService.remove(id, guest);

      expect(bookingJobs.withdrawals).toEqual(["pi_1"]);
    });

    it("withdraws the payment of a hold instead of refunding it", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await cancellationService.remove(id, guest);

      expect(bookingJobs.withdrawals).toEqual(["pi_1"]);
      expect(paymentGateway.refunds.size).toBe(0);
    });
  });
});
