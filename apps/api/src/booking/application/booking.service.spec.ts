import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  BookingStatus,
  NotificationType,
  Role,
  StayParty,
  type Booking,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import type { BookingPaymentHandler } from "./booking-payment.handler";
import { MAX_REFUND_ATTEMPTS, type BookingService } from "./booking.service";
import {
  admin,
  AMOUNT,
  createBookingTestbed,
  GUEST_ID,
  guest,
  input,
  listing,
  LISTING_ID,
  OTHER_LISTING_ID,
  owner,
  OWNER_ID,
  payForStay,
  searchFor,
  stayAfter,
  stranger,
  STRANGER_ID,
  userWith,
  type FakeBookingJobs,
  type FakeBookingRepository,
  type FakeNotificationService,
  type FakePaymentGateway,
  type FakeStayListener,
  type FakeWaitlistService,
} from "./testing/booking.fakes";

/**
 * The service against fakes of its repositories, the gateway and a stay listener — see
 * `testing/booking.fakes.ts`. What the provider's news does to the stays is
 * `booking-payment.handler.spec.ts`'s.
 */
describe("BookingService", () => {
  let service: BookingService;
  let bookingRepository: FakeBookingRepository;
  let bookingJobs: FakeBookingJobs;
  let notificationService: FakeNotificationService;
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

  /** The stays one caller is handed, with a search of their own where one matters. */
  const seenBy = async (
    user: AuthenticatedUser,
    search: Record<string, string> = {},
  ): Promise<Booking[]> =>
    (await service.findPage(user, searchFor(search))).items;

  beforeEach(async () => {
    ({
      service,
      paymentHandler,
      bookingRepository,
      bookingJobs,
      notificationService,
      waitlistService,
      paymentGateway,
      stayListener,
    } = await createBookingTestbed());
  });

  it("stores the booking as a hold in the name of the signed-in guest", async () => {
    const booking = await service.create(GUEST_ID, input);

    expect(booking).toMatchObject({
      ...input,
      guestId: GUEST_ID,
      status: BookingStatus.PENDING_PAYMENT,
    });
    expect(booking.expiresAt).not.toBeNull();
  });

  it("schedules the hold's expiry for the deadline the row carries", async () => {
    const booking = await service.create(GUEST_ID, input);

    expect(bookingJobs.scheduled).toEqual([
      { bookingId: booking.id, runAt: new Date(String(booking.expiresAt)) },
    ]);
  });

  it("answers 404, not 500, when the listing is deleted just before the insert", async () => {
    bookingRepository.vanishingListing = true;

    await expect(service.create(GUEST_ID, input)).rejects.toThrow(
      NotFoundException,
    );
  });

  // The token names the guest and JwtStrategy reads no database, so nothing checks that row
  // before the insert. A gone account is an ended session — the 401 of `/auth/me` — and not
  // a 404 about a listing that is sitting there unbooked.
  it("answers 401 when the account behind the token is gone", async () => {
    bookingRepository.vanishingGuest = true;

    await expect(service.create(GUEST_ID, input)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("answers 403 to a host booking their own listing, and stores nothing", async () => {
    bookingRepository.listingOwnerId = GUEST_ID;

    await expect(service.create(GUEST_ID, input)).rejects.toThrow(
      ForbiddenException,
    );
    expect(bookingRepository.rows.size).toBe(0);
    expect(bookingJobs.scheduled).toEqual([]);
    expect(notificationService.notices).toEqual([]);
  });

  it("turns an overlap raised by the repository into a 409", async () => {
    await bookedByGuest();

    await expect(
      service.create(STRANGER_ID, { ...input, from: "2026-09-04" }),
    ).rejects.toThrow(ConflictException);
    expect(bookingRepository.rows.size).toBe(1);
  });

  it("narrows the list to what the role of the caller may see", async () => {
    await bookedByGuest();
    bookingRepository.listingOwnerId = GUEST_ID;
    await service.create(STRANGER_ID, {
      ...input,
      listingId: OTHER_LISTING_ID,
    });

    await expect(seenBy(guest)).resolves.toHaveLength(1);
    await expect(seenBy(owner, { side: StayParty.HOST })).resolves.toHaveLength(
      1,
    );
    await expect(seenBy(admin)).resolves.toHaveLength(2);
  });

  /**
   * An account is both sides of its stays at once, so `side` picks which half of them a
   * list is — and nothing else: either half is still the caller's own, and an admin's
   * scope has no halves.
   */
  it("hands an account that also hosts the side of its stays it asks for", async () => {
    const trip = await bookedByGuest();
    bookingRepository.listingOwnerId = GUEST_ID;
    const hosted = await service.create(STRANGER_ID, {
      ...input,
      listingId: OTHER_LISTING_ID,
    });

    const ids = async (
      user: AuthenticatedUser,
      side: StayParty,
    ): Promise<string[]> =>
      (await seenBy(user, { side })).map((booking) => booking.id);

    await expect(ids(guest, StayParty.GUEST)).resolves.toEqual([trip]);
    await expect(ids(guest, StayParty.HOST)).resolves.toEqual([hosted.id]);
    await expect(ids(admin, StayParty.GUEST)).resolves.toHaveLength(2);
  });

  /**
   * The filters narrow the scope the role gives and can never widen it, which is the whole
   * reason `guestId` is allowed to be one at all: for a guest it can only ever name
   * themselves, and naming somebody else answers with the empty list it truthfully is
   * rather than with that person's stays.
   */
  it("filters inside the scope of the caller, never around it", async () => {
    await bookedByGuest();
    await service.create(STRANGER_ID, {
      ...input,
      listingId: OTHER_LISTING_ID,
    });

    await expect(seenBy(guest, { guestId: STRANGER_ID })).resolves.toEqual([]);
    await expect(seenBy(admin, { guestId: STRANGER_ID })).resolves.toHaveLength(
      1,
    );
    await expect(
      seenBy(admin, { listingId: OTHER_LISTING_ID }),
    ).resolves.toHaveLength(1);
    await expect(
      seenBy(admin, { status: BookingStatus.CANCELLED }),
    ).resolves.toEqual([]);
  });

  /**
   * A page carries a cursor only while there is another one behind it, and the next page
   * starts after the row that cursor names — no row twice and none skipped, which is what
   * a keyset page buys over an offset a new booking would shift.
   */
  it("cuts the list into pages and issues a cursor only while there is one after", async () => {
    for (let taken = 0; taken < 3; taken += 1) {
      await service.create(GUEST_ID, stayAfter(taken));
    }

    const first = await service.findPage(guest, searchFor({ limit: "2" }));

    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.findPage(
      guest,
      searchFor({ limit: "2", cursor: String(first.nextCursor) }),
    );

    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.items.map((stay) => stay.id)).not.toContain(
      first.items[0]?.id,
    );
  });

  /**
   * A cursor names a place in one ordering and in no other: read under another it would
   * compare a check-in against a moment, and the rows after it would be a page of neither
   * list. Both refusals are the client's to act on — dropping the cursor starts the pages
   * again, which is exactly what changing the ordering means.
   */
  it("refuses a cursor from another ordering, and one it never issued", async () => {
    await bookedByGuest();
    await service.create(GUEST_ID, stayAfter(1));

    const page = await service.findPage(guest, searchFor({ limit: "1" }));
    const cursor = String(page.nextCursor);

    await expect(
      service.findPage(
        guest,
        searchFor({ limit: "1", cursor, sort: "oldest" }),
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.findPage(guest, searchFor({ cursor: "not-a-cursor" })),
    ).rejects.toThrow(BadRequestException);
  });

  it("orders by what was asked for, not by what was stored", async () => {
    const second = await service.create(GUEST_ID, stayAfter(2));
    const first = await service.create(GUEST_ID, stayAfter(0));

    await expect(
      seenBy(guest, { sort: "checkInAsc" }).then((stays) =>
        stays.map((stay) => stay.id),
      ),
    ).resolves.toEqual([first.id, second.id]);

    // `newest` is the default, and it is the moment the stay was taken rather than the
    // day it starts: the later booking of the earlier stay comes first.
    await expect(
      seenBy(guest).then((stays) => stays.map((stay) => stay.id)),
    ).resolves.toEqual([first.id, second.id]);

    await expect(
      seenBy(guest, { sort: "oldest" }).then((stays) =>
        stays.map((stay) => stay.id),
      ),
    ).resolves.toEqual([second.id, first.id]);
  });

  it("shows a booking to its guest, to the owner of the listing and to an admin", async () => {
    const id = await bookedByGuest();

    for (const user of [guest, owner, admin]) {
      await expect(service.findOne(id, user)).resolves.toMatchObject({ id });
    }
  });

  // 404 rather than 403: nothing lets a stranger list bookings, so a 403 would be the one
  // way to learn that an id exists. Cancelling is the other rule and answers differently.
  it("hides it from everyone else, as if it were not there", async () => {
    const id = await bookedByGuest();

    await expect(service.findOne(id, stranger)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.remove(id, stranger)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.findOne(id, guest)).resolves.toMatchObject({ id });
  });

  it("lets the guest and an admin cancel, and the owner of the listing only look", async () => {
    const id = await bookedByGuest();

    // Reading the bookings against your listing is not the same right as cancelling one.
    await expect(service.remove(id, owner)).rejects.toThrow(ForbiddenException);
    await expect(service.findOne(id, owner)).resolves.toMatchObject({ id });

    await service.remove(id, guest);
    expect(bookingJobs.cancelled).toContain(id);

    const second = await bookedByGuest();
    await service.remove(second, admin);

    await expect(seenBy(admin)).resolves.toHaveLength(2);
  });

  // The lease would otherwise let anybody who knows an id keep the guest's own
  // cancellation and the refund's webhook waiting behind refused requests.
  it("takes the cancellation lease only for somebody who may cancel", async () => {
    const id = await bookedByGuest();

    await expect(service.remove(id, owner)).rejects.toThrow(ForbiddenException);
    await expect(service.remove(id, stranger)).rejects.toThrow(
      NotFoundException,
    );
    expect(bookingRepository.leases).toEqual([]);

    await service.remove(id, guest);
    expect(bookingRepository.leases).toEqual([id]);
  });

  it("tells the host about a hold the moment it is taken", async () => {
    const booking = await service.create(GUEST_ID, input);

    expect(notificationService.notices).toEqual([
      {
        userId: OWNER_ID,
        content: {
          type: NotificationType.BOOKING_REQUESTED,
          data: {
            bookingId: booking.id,
            listingId: LISTING_ID,
            listingTitle: listing.title,
            from: input.from,
            to: input.to,
          },
        },
      },
    ]);
  });

  it("tells the host when the guest cancels, and both sides when an admin does", async () => {
    const recipientsOfCancelling = async (
      canceller: AuthenticatedUser,
    ): Promise<{ userId: string; recipient: string }[]> => {
      const id = await bookedByGuest();

      notificationService.notices.length = 0;
      await service.remove(id, canceller);

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

  describe("the waitlist", () => {
    const nights = { listingId: LISTING_ID, from: input.from, to: input.to };

    it("hands it the nights a cancellation let go of", async () => {
      const id = await bookedByGuest();

      await service.remove(id, guest);

      expect(waitlistService.freed).toEqual([nights]);
    });

    it("hands it nothing for a cancellation it refused", async () => {
      const id = await bookedByGuest();

      await expect(service.remove(id, owner)).rejects.toThrow(
        ForbiddenException,
      );

      expect(waitlistService.freed).toEqual([]);
    });

    it("hands it the nights of a lapsed hold, on every path that releases one", async () => {
      const byJob = await bookedByGuest();

      bookingRepository.lapsed.add(byJob);
      await service.releaseHold(byJob);
      expect(waitlistService.freed).toEqual([nights]);

      bookingRepository.lapsed.add(await bookedByGuest());
      await service.releaseLapsedHolds();
      expect(waitlistService.freed).toEqual([nights, nights]);

      bookingRepository.lapsed.add(await bookedByGuest());
      await service.create(GUEST_ID, input);
      expect(waitlistService.freed).toEqual([nights, nights, nights]);
    });

    it("hands it nothing when nothing was released", async () => {
      await bookedByGuest();
      await service.releaseLapsedHolds();

      expect(waitlistService.freed).toEqual([]);
    });
  });

  describe("a lapsed hold", () => {
    /** Who heard about an expiry, and as which side of the stay. */
    const expiryNotices = (): { userId: string; recipient: string }[] =>
      notificationService.notices.flatMap(({ userId, content }) =>
        content.type === NotificationType.BOOKING_EXPIRED
          ? [{ userId, recipient: content.data.recipient }]
          : [],
      );

    const lapsedHold = async (): Promise<string> => {
      const id = await bookedByGuest();

      bookingRepository.lapsed.add(id);
      notificationService.notices.length = 0;

      return id;
    };

    const bothSides = [
      { userId: GUEST_ID, recipient: StayParty.GUEST },
      { userId: OWNER_ID, recipient: StayParty.HOST },
    ];

    it("tells both sides when its own job releases it", async () => {
      const id = await lapsedHold();

      await service.releaseHold(id);

      expect(expiryNotices()).toEqual(bothSides);
      expect(notificationService.notices[0]?.content.data).toMatchObject({
        bookingId: id,
        listingId: LISTING_ID,
        listingTitle: listing.title,
        from: input.from,
        to: input.to,
      });
    });

    it("tells both sides when the sweep releases it, and counts it", async () => {
      await lapsedHold();

      await expect(service.releaseLapsedHolds()).resolves.toBe(1);
      expect(expiryNotices()).toEqual(bothSides);
    });

    it("tells both sides when a booking of the same listing releases it", async () => {
      await lapsedHold();

      await service.create(GUEST_ID, input);

      expect(expiryNotices()).toEqual(bothSides);
      // The release happened first, so the host reads it before the request that followed.
      expect(
        notificationService.notices
          .filter(({ userId }) => userId === OWNER_ID)
          .map(({ content }) => content.type),
      ).toEqual([
        NotificationType.BOOKING_EXPIRED,
        NotificationType.BOOKING_REQUESTED,
      ]);
    });

    it("tells nobody when the job lands on a hold no longer pending", async () => {
      const id = await lapsedHold();

      await service.remove(id, guest);
      notificationService.notices.length = 0;

      await service.releaseHold(id);
      await expect(service.releaseLapsedHolds()).resolves.toBe(0);
      expect(notificationService.notices).toEqual([]);
    });

    it("tells nobody twice when the job and the sweep both reach it", async () => {
      const id = await lapsedHold();

      await service.releaseHold(id);
      await service.releaseLapsedHolds();

      expect(expiryNotices()).toEqual(bothSides);
    });
  });

  it("tells nobody about a cancellation it refused", async () => {
    const id = await bookedByGuest();

    notificationService.notices.length = 0;
    await expect(service.remove(id, owner)).rejects.toThrow(ForbiddenException);

    expect(notificationService.notices).toEqual([]);
  });

  /**
   * A cancelled stay is a record, not a deletion — phase 6 refunds against it. So it keeps
   * answering its guest, with the status saying what happened and the deadline the hold
   * had still on it, and only a second cancellation is refused.
   */
  it("keeps the cancelled booking readable, and refuses to cancel it twice", async () => {
    const id = await bookedByGuest();
    const held = await service.findOne(id, guest);

    await service.remove(id, guest);

    await expect(service.findOne(id, guest)).resolves.toMatchObject({
      id,
      status: BookingStatus.CANCELLED,
      expiresAt: held.expiresAt,
    });
    await expect(service.remove(id, guest)).rejects.toThrow(NotFoundException);
  });

  it("throws NotFoundException for an unknown id", async () => {
    await expect(service.findOne(LISTING_ID, admin)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.remove(LISTING_ID, admin)).rejects.toThrow(
      NotFoundException,
    );
  });

  /**
   * The cast is the point of the test: the type says this cannot happen, and the runtime
   * is where it can — the role arrives in a signed token that JwtStrategy does not parse,
   * so one minted before a role was renamed still carries the old name. A role that fell
   * through the switch would reach no query at all, which is why it has to say so.
   */
  it("fails closed on a role no branch of the scope names", async () => {
    await bookedByGuest();

    const stale = userWith(STRANGER_ID, "MODERATOR" as unknown as Role);

    await expect(service.findPage(stale, searchFor())).rejects.toThrow(
      ForbiddenException,
    );
  });
  describe("the payment", () => {
    it("opens one payment per hold and answers the same one again", async () => {
      const id = await bookedByGuest();

      const first = await service.payment(id, guest);
      const second = await service.payment(id, guest);

      expect(first).toEqual({
        clientSecret: "pi_1_secret",
        amount: AMOUNT,
        currency: "eur",
      });
      expect(second).toEqual(first);
      expect(bookingRepository.rows.get(id)?.paymentId).toBe("pi_1");
    });

    it("answers the guest alone, and hides the stay from a stranger", async () => {
      const id = await bookedByGuest();

      // The host and an admin may read the stay; paying for it is not theirs.
      await expect(service.payment(id, owner)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.payment(id, admin)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.payment(id, stranger)).rejects.toThrow(
        NotFoundException,
      );
      expect(paymentGateway.opened.size).toBe(0);
    });

    it("refuses a booking that no longer waits for payment", async () => {
      const cancelled = await bookedByGuest();
      await service.remove(cancelled, guest);

      await expect(service.payment(cancelled, guest)).rejects.toThrow(
        ConflictException,
      );

      // Past its deadline but not released yet: the sweep is about to give the nights away.
      const lapsing = (await service.create(GUEST_ID, stayAfter(1))).id;
      const found = bookingRepository.rows.get(lapsing);

      if (found === undefined) throw new Error("The hold was not stored");

      found.booking.expiresAt = new Date(Date.now() - 1_000).toISOString();

      await expect(service.payment(lapsing, guest)).rejects.toThrow(
        ConflictException,
      );
      expect(paymentGateway.opened.size).toBe(0);
    });

    it("answers a second request opening the same payment with a 409 to retry", async () => {
      const id = await bookedByGuest();
      paymentGateway.openingElsewhere = true;

      await expect(service.payment(id, guest)).rejects.toThrow(
        ConflictException,
      );
      expect(bookingRepository.rows.get(id)?.paymentId).toBeNull();

      paymentGateway.openingElsewhere = false;

      await expect(service.payment(id, guest)).resolves.toMatchObject({
        clientSecret: "pi_1_secret",
      });
    });

    it("withdraws a payment opened while the hold was being released", async () => {
      const id = await bookedByGuest();
      bookingRepository.lapsed.add(id);
      bookingRepository.racing = () => service.releaseHold(id);

      await expect(service.payment(id, guest)).rejects.toThrow(
        ConflictException,
      );
      expect(bookingRepository.rows.get(id)?.paymentId).toBeNull();
      expect(bookingJobs.withdrawals).toEqual(["pi_1"]);
    });
  });

  describe("cancelling", () => {
    it("refunds a guest in full inside the free window, by the job the cancellation queues", async () => {
      const id = await paidStay(30);

      await service.remove(id, guest);

      expect([...paymentGateway.refunds.entries()]).toEqual([
        [`booking-${id}-cancellation`, { paymentId: "pi_1", amount: AMOUNT }],
      ]);
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: AMOUNT,
      });
    });

    it("records the refund an earlier attempt sent rather than sending another", async () => {
      const id = await paidStay(30);
      // Sent by a run whose answer was lost, for less than the stay — the key is what names it.
      paymentGateway.refunds.set(`booking-${id}-cancellation`, {
        paymentId: "pi_1",
        amount: 100,
      });

      await service.remove(id, guest);

      expect(paymentGateway.refunds.size).toBe(1);
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        refundedAmount: 100,
        refundOwed: null,
      });
    });

    it("refunds a guest nothing once the window has closed", async () => {
      const id = await paidStay(1);

      await service.remove(id, guest);

      expect(paymentGateway.refunds.size).toBe(0);
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: null,
      });
    });

    it("refunds only what a dashboard refund left of the payment", async () => {
      const id = await paidStay(30);
      await paymentHandler.handle({
        kind: "refunded",
        eventId: "evt_dashboard",
        type: "charge.refunded",
        paymentId: "pi_1",
        chargeId: "ch_pi_1",
        amountRefunded: 100,
      });

      await service.remove(id, guest);

      expect([...paymentGateway.refunds.values()]).toEqual([
        { paymentId: "pi_1", amount: AMOUNT - 100 },
      ]);
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: AMOUNT,
      });
      expect(stayListener.settled.at(-1)).toEqual({
        bookingId: id,
        refunded: AMOUNT,
      });
    });

    it("refunds only what is left when a dashboard refund has not been reported yet", async () => {
      const id = await paidStay(30);
      paymentGateway.refundedUnreported.set("pi_1", 100);

      await service.remove(id, guest);

      expect([...paymentGateway.refunds.values()]).toEqual([
        { paymentId: "pi_1", amount: AMOUNT - 100 },
      ]);
      // The row counts its own refund only: the dashboard's is its webhook's to tell.
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: AMOUNT - 100,
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
        amountRefunded: 100,
      });

      await service.remove(id, guest);

      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: 100,
      });
    });

    it("refuses to cancel a stay whose payment is disputed until the bank decides", async () => {
      const id = await paidStay(30);
      const found = bookingRepository.rows.get(id);

      if (found !== undefined) found.booking.dispute = "OPEN";

      await expect(service.remove(id, admin)).rejects.toThrow(
        ConflictException,
      );
      expect(paymentGateway.refunds.size).toBe(0);
      expect(found?.booking.status).toBe(BookingStatus.CONFIRMED);
    });

    it("cancels a stay whose dispute was lost without refunding it again", async () => {
      const id = await paidStay(30);
      const found = bookingRepository.rows.get(id);

      if (found !== undefined) found.booking.dispute = "LOST";

      await service.remove(id, admin);

      expect(paymentGateway.refunds.size).toBe(0);
      expect(found?.booking.status).toBe(BookingStatus.CANCELLED);
    });

    it("cancels at once and owes the refund until the job sends it", async () => {
      const id = await paidStay(30);
      bookingJobs.worker = null;

      await service.remove(id, guest);

      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: null,
        refundOwed: AMOUNT,
      });
      expect(paymentGateway.refunds.size).toBe(0);
      expect(bookingJobs.refunds).toEqual([id]);
      expect(waitlistService.freed).toHaveLength(1);

      await expect(service.refundCancellation(id)).resolves.toBe(true);
      // A second run — the sweep racing the job — finds nothing owed.
      await expect(service.refundCancellation(id)).resolves.toBe(false);

      expect(paymentGateway.refunds.size).toBe(1);
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        refundedAmount: AMOUNT,
        refundOwed: null,
      });
    });

    it("refunds an admin's cancellation in full after the free window", async () => {
      const id = await paidStay(1);

      await service.remove(id, admin);

      expect(bookingRepository.rows.get(id)?.booking.refundedAmount).toBe(
        AMOUNT,
      );
    });

    it("refuses the guest and an admin alike once the stay has begun", async () => {
      const id = await paidStay(0);

      await expect(service.remove(id, guest)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.remove(id, admin)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(bookingRepository.rows.get(id)?.booking.status).toBe(
        BookingStatus.CONFIRMED,
      );
      expect(paymentGateway.refunds.size).toBe(0);
    });

    it("takes the host's share of a cancellation's refund back once it is sent", async () => {
      const id = await paidStay(1);

      await service.remove(id, admin);

      expect(stayListener.settled).toEqual([
        { bookingId: id, refunded: AMOUNT },
      ]);
    });

    it("settles nothing for a cancellation that refunds nothing", async () => {
      const id = await paidStay(1);

      await service.remove(id, guest);

      expect(stayListener.settled).toEqual([]);
    });

    it("cancels when the refund cannot be issued yet, and the sweep sends it later", async () => {
      const id = await paidStay(30);
      paymentGateway.refusing = true;

      await service.remove(id, guest);

      expect(bookingJobs.failedRefunds).toHaveLength(1);
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundOwed: AMOUNT,
      });

      // Still refused: logged and left for the next minute, not thrown out of the sweep.
      await expect(service.refundOwedCancellations()).resolves.toBe(0);

      paymentGateway.refusing = false;

      await expect(service.refundOwedCancellations()).resolves.toBe(1);
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        refundedAmount: AMOUNT,
        refundOwed: null,
      });
    });

    it("sets a refund Stripe keeps refusing aside and tells the admins", async () => {
      const id = await paidStay(30);
      bookingJobs.worker = null;
      await service.remove(id, guest);
      paymentGateway.refusing = true;

      for (let run = 1; run < MAX_REFUND_ATTEMPTS; run += 1) {
        await expect(service.refundCancellation(id)).rejects.toThrow();
      }

      expect(notificationService.toAdmins).toEqual([]);

      // The last attempt ends the job's retries instead of failing it once more.
      await expect(service.refundCancellation(id)).resolves.toBe(false);
      expect(notificationService.toAdmins).toEqual([
        {
          type: NotificationType.CANCELLATION_REFUND_FAILED,
          data: { bookingId: id, error: expect.any(String) as string },
        },
      ]);
      // Still owed, and left to a person: the sweep no longer reads it.
      expect(bookingRepository.rows.get(id)?.booking.refundOwed).toBe(AMOUNT);
      await expect(bookingRepository.findOwedRefunds(50)).resolves.toEqual([]);
    });

    it("reads the debts that failed least first, so one that keeps failing cannot block the rest", async () => {
      const failing = await paidStay(30);
      bookingJobs.worker = null;
      await service.remove(failing, guest);
      await bookingRepository.recordRefundFailure(failing, "refused", 99);

      const fresh = await paidStay(31);
      await service.remove(fresh, guest);

      await expect(bookingRepository.findOwedRefunds(1)).resolves.toEqual([
        fresh,
      ]);
    });

    it("keeps a refund owed while a dispute opened after the cancellation is open", async () => {
      const id = await paidStay(30);
      bookingJobs.worker = null;
      await service.remove(id, guest);
      const found = bookingRepository.rows.get(id);

      if (found !== undefined) found.booking.dispute = "OPEN";

      await expect(service.refundOwedCancellations()).resolves.toBe(0);
      expect(paymentGateway.refunds.size).toBe(0);
      expect(found?.booking.refundOwed).toBe(AMOUNT);

      // Won: the money is still the platform's, and it goes back as the cancellation said.
      if (found !== undefined) found.booking.dispute = "WON";

      await expect(service.refundOwedCancellations()).resolves.toBe(1);
      expect(found?.booking.refundedAmount).toBe(AMOUNT);
    });

    it("drops a refund owed once a dispute opened after the cancellation is lost", async () => {
      const id = await paidStay(30);
      bookingJobs.worker = null;
      await service.remove(id, guest);
      const found = bookingRepository.rows.get(id);

      if (found !== undefined) found.booking.dispute = "LOST";

      await expect(service.refundOwedCancellations()).resolves.toBe(0);
      expect(paymentGateway.refunds.size).toBe(0);
      expect(found?.booking.refundOwed).toBeNull();
    });

    it("leaves a hold paid for mid-cancellation confirmed, and asks for another try", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      bookingRepository.racing = async (racedId) => {
        bookingRepository.racing = null;
        await bookingRepository.confirmPayment(racedId, "pi_1", null, AMOUNT);
      };

      await expect(service.remove(id, guest)).rejects.toThrow(
        ConflictException,
      );
      expect(bookingRepository.rows.get(id)?.booking.status).toBe(
        BookingStatus.CONFIRMED,
      );
      expect(bookingJobs.withdrawals).toEqual([]);
    });

    it("withdraws a payment a payment page opened while the hold was being cancelled", async () => {
      const id = await bookedByGuest();
      bookingRepository.racing = async () => {
        bookingRepository.racing = null;
        await service.payment(id, guest);
      };

      await service.remove(id, guest);

      expect(bookingJobs.withdrawals).toEqual(["pi_1"]);
    });

    it("withdraws the payment of a hold instead of refunding it", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await service.remove(id, guest);

      expect(bookingJobs.withdrawals).toEqual(["pi_1"]);
      expect(paymentGateway.refunds.size).toBe(0);
    });
  });

  describe("a lapsed hold's payment", () => {
    it("is queued for withdrawal by whichever path releases the hold", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      bookingRepository.lapsed.add(id);

      await service.releaseLapsedHolds();

      expect(bookingJobs.withdrawals).toEqual(["pi_1"]);
    });

    it("is withdrawn by the job, not by the path that released the hold", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      bookingRepository.lapsed.add(id);

      await service.releaseHold(id);

      expect(paymentGateway.withdrawn).toEqual([]);

      await service.withdrawPayment("pi_1");

      expect(paymentGateway.withdrawn).toEqual(["pi_1"]);
    });

    it("leaves a withdrawal the provider refuses to the job's next attempt", async () => {
      paymentGateway.refusingWithdrawal = true;

      await expect(service.withdrawPayment("pi_1")).rejects.toThrow();
    });
  });
});
