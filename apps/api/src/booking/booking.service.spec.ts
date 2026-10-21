import { tz } from "@date-fns/tz";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { addDays, format, parseISO } from "date-fns";
import { randomUUID } from "node:crypto";
import {
  bookingQuerySchema,
  BookingStatus,
  NotificationType,
  Role,
  StayParty,
  type BookedRange,
  type Booking,
  type BookingQuery,
  type BookingSort,
  type CreateBookingInput,
  type ListingSummary,
  type NotificationContent,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { Page } from "../common/paging";
import { NotificationService } from "../notification/notification.service";
import {
  BookingRepository,
  DatesUnavailableError,
  GuestNotFoundError,
  ListingNotFoundError,
  OwnListingError,
  type BookingWithListingOwner,
  type CreatedBooking,
  type ReleasedHold,
} from "./booking.repository";
import type { BookingCursor } from "./booking-cursor";
import { BookingService, stayNoticeOf } from "./booking.service";
import { BookingExpiryQueue } from "./booking-expiry.queue";
import { ACTIVE_STATUSES, holdExpiry } from "./domain/booking-status";

const GUEST_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const OWNER_ID = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";
const STRANGER_ID = "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f50";
const LISTING_ID = "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b";
const OTHER_LISTING_ID = "3a4b5c6d-7e8f-4091-8a2b-3c4d5e6f7a8b";

/** What the repository resolves beside every stay; no rule in this service reads it. */
const listing: ListingSummary = {
  title: "Loft above the harbour",
  pricePerNight: 120,
};

const input: CreateBookingInput = {
  listingId: LISTING_ID,
  from: "2026-09-01",
  to: "2026-09-05",
};

const IN_UTC = { in: tz("UTC") };

const day = (offset: number): string =>
  format(addDays(parseISO("2026-09-01", IN_UTC), offset), "yyyy-MM-dd");

/**
 * The nth stay of a fixture that needs several: a week apart, so no two of them overlap
 * and the fake refuses none — what these specs are about is the paging and the ordering,
 * not the slot.
 */
const stayAfter = (index: number): CreateBookingInput => ({
  ...input,
  from: day(index * 7),
  to: day(index * 7 + 2),
});

const userWith = (id: string, role: Role): AuthenticatedUser => ({
  id,
  email: "someone@example.com",
  role,
});

const guest = userWith(GUEST_ID, Role.USER);
const owner = userWith(OWNER_ID, Role.USER);
const stranger = userWith(STRANGER_ID, Role.USER);
const admin = userWith(STRANGER_ID, Role.ADMIN);

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
type PublicOf<T> = { [K in keyof T]: T[K] };

/**
 * A query as it reaches the service: parsed by the contract rather than written out, so a
 * spec never states a default the API does not have.
 */
const searchFor = (search: Record<string, string> = {}): BookingQuery =>
  bookingQuerySchema.parse(search);

const compare = (left: string, right: string): number => {
  if (left < right) return -1;

  return left > right ? 1 : 0;
};

/** The four orderings of the contract, with the tiebreaker following the key. */
const ordering =
  (sort: BookingSort) =>
  (left: Booking, right: Booking): number => {
    switch (sort) {
      case "newest":
        return (
          compare(right.createdAt, left.createdAt) || compare(right.id, left.id)
        );
      case "oldest":
        return (
          compare(left.createdAt, right.createdAt) || compare(left.id, right.id)
        );
      case "checkInAsc":
        return compare(left.from, right.from) || compare(left.id, right.id);
      case "checkInDesc":
        return compare(right.from, left.from) || compare(right.id, left.id);
    }
  };

const isActive = (booking: Booking): boolean =>
  ACTIVE_STATUSES.includes(booking.status);

/**
 * The repository is faked rather than mocked: what the rules here decide is which rows a
 * caller ends up with and which ones are refused. The overlap semantics, the locking
 * transaction and the date mapping belong to the repository, so they are covered by e2e
 * against a real database instead of restated here — the fake only has to reject an
 * overlap with an active row so the service's `409` translation is exercised.
 *
 * Reads return a row whatever its status, and only the rules about the slot — the overlap
 * on create, what `cancel` will still accept — narrow to the active ones. That is the
 * repository's shape, and getting it wrong here would let the spec assert a booking
 * disappears when the API says it turns `CANCELLED`.
 */
class FakeBookingRepository implements PublicOf<BookingRepository> {
  readonly rows = new Map<string, BookingWithListingOwner>();

  /** The listing this fake creates bookings against, unless the row says otherwise. */
  listingOwnerId = OWNER_ID;

  /** Set to have `create` lose the race the pre-flight check cannot close. */
  vanishingListing = false;

  /** Set to have `create` fail on the other key: the account behind the token is gone. */
  vanishingGuest = false;

  /**
   * The holds whose deadline has passed. The fake keeps no clock: a spec names the holds it
   * wants lapsed, and the three expiry paths release exactly those that are still pending.
   */
  readonly lapsed = new Set<string>();

  findPageForEveryone(
    query: BookingQuery,
    cursor: BookingCursor | null,
  ): Promise<Page<Booking>> {
    return this.pageOf(this.allBookings(), query, cursor);
  }

  findPageForGuest(
    guestId: string,
    query: BookingQuery,
    cursor: BookingCursor | null,
  ): Promise<Page<Booking>> {
    return this.pageOf(
      this.allBookings().filter((booking) => booking.guestId === guestId),
      query,
      cursor,
    );
  }

  findPageForListingOwner(
    ownerId: string,
    query: BookingQuery,
    cursor: BookingCursor | null,
  ): Promise<Page<Booking>> {
    return this.pageOf(
      [...this.rows.values()]
        .filter((found) => found.listingOwnerId === ownerId)
        .map((found) => found.booking),
      query,
      cursor,
    );
  }

  findByIdWithListingOwner(
    id: string,
  ): Promise<BookingWithListingOwner | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  hasStayedWith(guestId: string, ownerId: string): Promise<boolean> {
    return Promise.resolve(
      [...this.rows.values()].some(
        (found) =>
          found.booking.guestId === guestId &&
          found.listingOwnerId === ownerId &&
          isActive(found.booking),
      ),
    );
  }

  create(
    guestId: string,
    booking: CreateBookingInput,
  ): Promise<CreatedBooking> {
    if (this.vanishingListing) {
      return Promise.reject(new ListingNotFoundError(booking.listingId));
    }

    if (this.vanishingGuest) {
      return Promise.reject(new GuestNotFoundError(guestId));
    }

    if (this.listingOwnerId === guestId) {
      return Promise.reject(new OwnListingError(booking.listingId));
    }

    // Released before the overlap check, as the transaction does; a refusal below would
    // roll that back with it, which this fake does not model — no spec refuses after one.
    const released = this.release(
      (found) => found.booking.listingId === booking.listingId,
    );

    const overlaps = this.allBookings()
      .filter(isActive)
      .some(
        (stay) =>
          stay.listingId === booking.listingId &&
          stay.from < booking.to &&
          stay.to > booking.from,
      );

    if (overlaps) {
      return Promise.reject(new DatesUnavailableError(booking));
    }

    const stored: Booking = {
      // A uuid and a distinct moment, because the cursor the service issues off the last
      // row of a page is parsed back as untrusted input: `booking-2` is not an id the
      // contract's `uuid()` reads, and rows sharing one `createdAt` would leave the
      // ordering to the tiebreaker alone.
      id: randomUUID(),
      listingId: booking.listingId,
      listing,
      guestId,
      from: booking.from,
      to: booking.to,
      status: BookingStatus.PENDING_PAYMENT,
      expiresAt: holdExpiry(new Date()).toISOString(),
      createdAt: new Date(
        Date.parse("2026-08-17T12:00:00.000Z") + this.rows.size * 1_000,
      ).toISOString(),
      reviewed: { byGuest: false, byOwner: false },
    };

    const created = { booking: stored, listingOwnerId: this.listingOwnerId };

    this.rows.set(stored.id, created);

    return Promise.resolve({ ...created, released });
  }

  cancel(id: string): Promise<boolean> {
    const found = this.rows.get(id);

    if (found === undefined || !isActive(found.booking)) {
      return Promise.resolve(false);
    }

    found.booking.status = BookingStatus.CANCELLED;

    return Promise.resolve(true);
  }

  expireHold(id: string): Promise<ReleasedHold[]> {
    return Promise.resolve(this.release((found) => found.booking.id === id));
  }

  expireLapsedHolds(): Promise<ReleasedHold[]> {
    return Promise.resolve(this.release(() => true));
  }

  /** The lapsed, still pending holds among those `which` picks, flipped to `EXPIRED`. */
  private release(
    which: (found: BookingWithListingOwner) => boolean,
  ): ReleasedHold[] {
    return [...this.rows.values()]
      .filter(
        (found) =>
          which(found) &&
          this.lapsed.has(found.booking.id) &&
          found.booking.status === BookingStatus.PENDING_PAYMENT,
      )
      .map(({ booking, listingOwnerId }) => {
        booking.status = BookingStatus.EXPIRED;

        return {
          stay: stayNoticeOf(booking),
          guestId: booking.guestId,
          listingOwnerId,
        };
      });
  }

  /** Read by `ListingService`, never by this one — see `listing.service.spec.ts`. */
  findActiveRanges(
    listingId: string,
    window: { from: string; to: string },
  ): Promise<BookedRange[]> {
    return Promise.resolve(
      this.allBookings()
        .filter(
          (stay) =>
            stay.listingId === listingId &&
            isActive(stay) &&
            stay.from < window.to &&
            stay.to > window.from,
        )
        .map((stay) => ({ from: stay.from, to: stay.to })),
    );
  }

  /**
   * The filters, the ordering and the cursor, in memory. They belong to the repository and
   * are exercised against a real database by the e2e specs — what the fake has to get
   * right is the shape the service reasons about: a scope narrowed further by the filters
   * (never widened by them), `limit` rows with `hasMore` beside them, and a page that
   * starts after the row the cursor names.
   */
  private pageOf(
    rows: Booking[],
    query: BookingQuery,
    cursor: BookingCursor | null,
  ): Promise<Page<Booking>> {
    const matching = rows
      .filter(
        (stay) => query.status === undefined || stay.status === query.status,
      )
      .filter(
        (stay) =>
          query.listingId === undefined || stay.listingId === query.listingId,
      )
      .filter(
        (stay) => query.guestId === undefined || stay.guestId === query.guestId,
      )
      .filter(
        (stay) =>
          query.from === undefined ||
          query.to === undefined ||
          (stay.from < query.to && stay.to > query.from),
      )
      .sort(ordering(query.sort));

    const start =
      cursor === null
        ? 0
        : matching.findIndex((stay) => stay.id === cursor.id) + 1;

    return Promise.resolve({
      items: matching.slice(start, start + query.limit),
      hasMore: matching.length > start + query.limit,
    });
  }

  private allBookings(): Booking[] {
    return [...this.rows.values()].map((found) => found.booking);
  }
}

/**
 * `runAt` is taken as an argument rather than ignored, because that is the only thing the
 * service decides about the deadline: it forwards the one the repository wrote. A fake
 * with the shorter signature stays assignable (see `PublicOf` above), so nothing but this
 * would notice a service that scheduled the job for the wrong moment — or for `now`.
 */
class FakeBookingExpiryQueue implements PublicOf<BookingExpiryQueue> {
  readonly scheduled: { bookingId: string; runAt: Date }[] = [];
  readonly cancelled: string[] = [];

  onApplicationBootstrap(): void {}

  scheduleExpiry(bookingId: string, runAt: Date): Promise<void> {
    this.scheduled.push({ bookingId, runAt });

    return Promise.resolve();
  }

  cancelExpiry(bookingId: string): Promise<void> {
    this.cancelled.push(bookingId);

    return Promise.resolve();
  }
}

/**
 * Only `notify`, the one method this service calls: what is asserted is who was told what,
 * and the storing and pushing behind it are `notification.service.spec.ts`'s.
 */
class FakeNotificationService implements Pick<NotificationService, "notify"> {
  readonly notices: { userId: string; content: NotificationContent }[] = [];

  notify(userId: string, content: NotificationContent): Promise<void> {
    this.notices.push({ userId, content });

    return Promise.resolve();
  }
}

describe("BookingService", () => {
  let service: BookingService;
  let bookingRepository: FakeBookingRepository;
  let bookingExpiryQueue: FakeBookingExpiryQueue;
  let notificationService: FakeNotificationService;

  /** A booking `guest` took against a listing `owner` owns — the row every rule acts on. */
  const bookedByGuest = async (): Promise<string> =>
    (await service.create(GUEST_ID, input)).id;

  /** The stays one caller is handed, with a search of their own where one matters. */
  const seenBy = async (
    user: AuthenticatedUser,
    search: Record<string, string> = {},
  ): Promise<Booking[]> =>
    (await service.findPage(user, searchFor(search))).items;

  beforeEach(async () => {
    bookingRepository = new FakeBookingRepository();
    bookingExpiryQueue = new FakeBookingExpiryQueue();
    notificationService = new FakeNotificationService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: BookingRepository, useValue: bookingRepository },
        { provide: BookingExpiryQueue, useValue: bookingExpiryQueue },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = moduleRef.get(BookingService);
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

    expect(bookingExpiryQueue.scheduled).toEqual([
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
    expect(bookingExpiryQueue.scheduled).toEqual([]);
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
    expect(bookingExpiryQueue.cancelled).toContain(id);

    const second = await bookedByGuest();
    await service.remove(second, admin);

    await expect(seenBy(admin)).resolves.toHaveLength(2);
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
});
