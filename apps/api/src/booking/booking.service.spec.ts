import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  BookingStatus,
  Role,
  type BookedRange,
  type Booking,
  type CreateBookingInput,
  type ListingSummary,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import {
  BookingRepository,
  DatesUnavailableError,
  GuestNotFoundError,
  ListingNotFoundError,
  type BookingWithListingOwner,
} from "./booking.repository";
import { BookingService } from "./booking.service";
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

const userWith = (id: string, role: Role): AuthenticatedUser => ({
  id,
  email: "someone@example.com",
  role,
});

const guest = userWith(GUEST_ID, Role.USER);
const owner = userWith(OWNER_ID, Role.OWNER);
const stranger = userWith(STRANGER_ID, Role.USER);
const admin = userWith(STRANGER_ID, Role.ADMIN);

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
type PublicOf<T> = { [K in keyof T]: T[K] };

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

  findAll(): Promise<Booking[]> {
    return Promise.resolve(this.allBookings());
  }

  findByGuest(guestId: string): Promise<Booking[]> {
    return Promise.resolve(
      this.allBookings().filter((booking) => booking.guestId === guestId),
    );
  }

  findByListingOwner(ownerId: string): Promise<Booking[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((found) => found.listingOwnerId === ownerId)
        .map((found) => found.booking),
    );
  }

  findByIdWithListingOwner(
    id: string,
  ): Promise<BookingWithListingOwner | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  create(guestId: string, booking: CreateBookingInput): Promise<Booking> {
    if (this.vanishingListing) {
      return Promise.reject(new ListingNotFoundError(booking.listingId));
    }

    if (this.vanishingGuest) {
      return Promise.reject(new GuestNotFoundError(guestId));
    }

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
      id: `booking-${String(this.rows.size + 1)}`,
      listingId: booking.listingId,
      listing,
      guestId,
      from: booking.from,
      to: booking.to,
      status: BookingStatus.PENDING_PAYMENT,
      expiresAt: holdExpiry(new Date()).toISOString(),
      createdAt: "2026-08-17T12:00:00.000Z",
    };

    this.rows.set(stored.id, {
      booking: stored,
      listingOwnerId: this.listingOwnerId,
    });

    return Promise.resolve(stored);
  }

  cancel(id: string): Promise<boolean> {
    const found = this.rows.get(id);

    if (found === undefined || !isActive(found.booking)) {
      return Promise.resolve(false);
    }

    found.booking.status = BookingStatus.CANCELLED;

    return Promise.resolve(true);
  }

  expireHold(id: string): Promise<void> {
    const found = this.rows.get(id);

    if (found?.booking.status === BookingStatus.PENDING_PAYMENT) {
      found.booking.status = BookingStatus.EXPIRED;
    }

    return Promise.resolve();
  }

  expireLapsedHolds(): Promise<number> {
    return Promise.resolve(0);
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

describe("BookingService", () => {
  let service: BookingService;
  let bookingRepository: FakeBookingRepository;
  let bookingExpiryQueue: FakeBookingExpiryQueue;

  /** A booking `guest` took against a listing `owner` owns — the row every rule acts on. */
  const bookedByGuest = async (): Promise<string> =>
    (await service.create(GUEST_ID, input)).id;

  beforeEach(async () => {
    bookingRepository = new FakeBookingRepository();
    bookingExpiryQueue = new FakeBookingExpiryQueue();

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: BookingRepository, useValue: bookingRepository },
        { provide: BookingExpiryQueue, useValue: bookingExpiryQueue },
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

  it("turns an overlap raised by the repository into a 409", async () => {
    await bookedByGuest();

    await expect(
      service.create(STRANGER_ID, { ...input, from: "2026-09-04" }),
    ).rejects.toThrow(ConflictException);
    expect(bookingRepository.rows.size).toBe(1);
  });

  it("narrows the list to what the role of the caller may see", async () => {
    await bookedByGuest();
    bookingRepository.listingOwnerId = STRANGER_ID;
    await service.create(STRANGER_ID, {
      ...input,
      listingId: OTHER_LISTING_ID,
    });

    await expect(service.findAll(guest)).resolves.toHaveLength(1);
    await expect(service.findAll(owner)).resolves.toHaveLength(1);
    await expect(service.findAll(admin)).resolves.toHaveLength(2);
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

    await expect(service.findAll(admin)).resolves.toHaveLength(2);
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

    expect(() => service.findAll(stale)).toThrow(ForbiddenException);
  });
});
