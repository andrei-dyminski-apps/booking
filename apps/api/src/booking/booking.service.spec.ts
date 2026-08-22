import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Role, type Booking, type CreateBookingInput } from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import {
  BookingRepository,
  ListingNotFoundError,
  type BookingWithListingOwner,
} from "./booking.repository";
import { BookingService } from "./booking.service";

const GUEST_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const OWNER_ID = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";
const STRANGER_ID = "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f50";
const LISTING_ID = "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b";
const OTHER_LISTING_ID = "3a4b5c6d-7e8f-4091-8a2b-3c4d5e6f7a8b";

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

/**
 * The repository is faked rather than mocked: what the rules here decide is which rows a
 * caller ends up with and which ones are refused, and a mock that records arguments can
 * only assert the call the service happens to make today. The overlap semantics and the
 * date mapping now belong to the repository, so they are covered by e2e against a real
 * database instead of restated here.
 */
class FakeBookingRepository implements PublicOf<BookingRepository> {
  readonly rows = new Map<string, BookingWithListingOwner>();
  readonly listings = new Set<string>([LISTING_ID, OTHER_LISTING_ID]);

  /** The listing this fake creates bookings against, unless the row says otherwise. */
  listingOwnerId = OWNER_ID;

  /** Set to have `create` lose the race the pre-flight check cannot close. */
  vanishingListing = false;

  findAll(): Promise<Booking[]> {
    return Promise.resolve(this.all());
  }

  findByGuest(guestId: string): Promise<Booking[]> {
    return Promise.resolve(
      this.all().filter((booking) => booking.guestId === guestId),
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

  listingExists(listingId: string): Promise<boolean> {
    return Promise.resolve(this.listings.has(listingId));
  }

  findOverlapping(booking: CreateBookingInput): Promise<Booking | null> {
    const overlap = this.all().find(
      (stay) =>
        stay.listingId === booking.listingId &&
        stay.from < booking.to &&
        stay.to > booking.from,
    );

    return Promise.resolve(overlap ?? null);
  }

  create(guestId: string, booking: CreateBookingInput): Promise<Booking> {
    if (this.vanishingListing) {
      return Promise.reject(new ListingNotFoundError(booking.listingId));
    }

    const stored: Booking = {
      id: `booking-${String(this.rows.size + 1)}`,
      listingId: booking.listingId,
      guestId,
      from: booking.from,
      to: booking.to,
      createdAt: "2026-08-17T12:00:00.000Z",
    };

    this.rows.set(stored.id, {
      booking: stored,
      listingOwnerId: this.listingOwnerId,
    });

    return Promise.resolve(stored);
  }

  delete(id: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  private all(): Booking[] {
    return [...this.rows.values()].map((found) => found.booking);
  }
}

describe("BookingService", () => {
  let service: BookingService;
  let bookingRepository: FakeBookingRepository;

  /** A booking `guest` took against a listing `owner` owns — the row every rule acts on. */
  const bookedByGuest = async (): Promise<string> =>
    (await service.create(GUEST_ID, input)).id;

  beforeEach(async () => {
    bookingRepository = new FakeBookingRepository();

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: BookingRepository, useValue: bookingRepository },
      ],
    }).compile();

    service = moduleRef.get(BookingService);
  });

  it("stores the booking in the name of the signed-in guest", async () => {
    const booking = await service.create(GUEST_ID, input);

    expect(booking).toMatchObject({ ...input, guestId: GUEST_ID });
  });

  it("refuses to book a listing that does not exist", async () => {
    await expect(
      service.create(GUEST_ID, { ...input, listingId: STRANGER_ID }),
    ).rejects.toThrow(NotFoundException);
    expect(bookingRepository.rows.size).toBe(0);
  });

  it("answers 404, not 500, when the listing is deleted just before the insert", async () => {
    bookingRepository.vanishingListing = true;

    await expect(service.create(GUEST_ID, input)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects creation when an overlapping booking is found", async () => {
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
    expect(bookingRepository.rows.size).toBe(1);
  });

  it("lets the guest and an admin cancel, and the owner of the listing only look", async () => {
    const id = await bookedByGuest();

    // Reading the bookings against your listing is not the same right as cancelling one.
    await expect(service.remove(id, owner)).rejects.toThrow(ForbiddenException);
    expect(bookingRepository.rows.size).toBe(1);

    await service.remove(id, guest);
    expect(bookingRepository.rows.size).toBe(0);

    await service.remove(await bookedByGuest(), admin);
    expect(bookingRepository.rows.size).toBe(0);
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
