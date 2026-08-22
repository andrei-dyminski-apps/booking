import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  Role,
  type CreateListingInput,
  type Listing,
  type UpdateListingInput,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import {
  ListingHasBookingsError,
  ListingRepository,
} from "./listing.repository";
import { ListingService } from "./listing.service";

const OWNER_ID = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";
const OTHER_OWNER_ID = "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f50";
const UNKNOWN_ID = "0b6f7f6e-2f4c-4a52-9a5e-8f1f6d2c3b4a";

const input: CreateListingInput = {
  title: "Loft above the harbour",
  description: "Two rooms under the roof and a wall of glass facing the water.",
  pricePerNight: 12000,
  capacity: 4,
};

const userWith = (id: string, role: Role): AuthenticatedUser => ({
  id,
  email: "someone@example.com",
  role,
});

const owner = userWith(OWNER_ID, Role.OWNER);
const otherOwner = userWith(OTHER_OWNER_ID, Role.OWNER);
const admin = userWith(OTHER_OWNER_ID, Role.ADMIN);

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
type PublicOf<T> = { [K in keyof T]: T[K] };

/**
 * The repository is faked rather than mocked: the role check happens before the service,
 * in RolesGuard, so what is left to cover here is which rows a caller ends up with and
 * which ones are refused — and a mock that records arguments can only assert the call the
 * service happens to make today. The ordering, the row shape and the Prisma error codes
 * now belong to the repository and are covered by e2e against a real database.
 */
class FakeListingRepository implements PublicOf<ListingRepository> {
  readonly rows = new Map<string, Listing>();

  /** Stays booked against a listing — what `remove` counts before it deletes. */
  readonly bookings = new Map<string, number>();

  /** Set to have a write lose the race against a delete the read before it could not see. */
  vanishingListing = false;

  /** Set to have `delete` lose the race the booking count cannot close. */
  bookedDuringDelete = false;

  findAll(): Promise<Listing[]> {
    return Promise.resolve([...this.rows.values()]);
  }

  findByOwner(ownerId: string): Promise<Listing[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((listing) => listing.ownerId === ownerId),
    );
  }

  findById(id: string): Promise<Listing | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  create(ownerId: string, listing: CreateListingInput): Promise<Listing> {
    const stored: Listing = {
      id: `listing-${String(this.rows.size + 1)}`,
      ownerId,
      ...listing,
      createdAt: "2026-08-20T12:00:00.000Z",
      updatedAt: "2026-08-20T12:00:00.000Z",
    };

    this.rows.set(stored.id, stored);

    return Promise.resolve(stored);
  }

  update(id: string, listing: UpdateListingInput): Promise<Listing | null> {
    const stored = this.rows.get(id);

    if (stored === undefined || this.vanishingListing) {
      return Promise.resolve(null);
    }

    const updated: Listing = {
      ...stored,
      ...listing,
      updatedAt: "2026-08-21T12:00:00.000Z",
    };

    this.rows.set(id, updated);

    return Promise.resolve(updated);
  }

  countBookings(listingId: string): Promise<number> {
    return Promise.resolve(this.bookings.get(listingId) ?? 0);
  }

  delete(id: string): Promise<boolean> {
    if (this.bookedDuringDelete) {
      return Promise.reject(new ListingHasBookingsError(id));
    }

    return Promise.resolve(
      this.vanishingListing ? false : this.rows.delete(id),
    );
  }
}

describe("ListingService", () => {
  let service: ListingService;
  let listingRepository: FakeListingRepository;

  /** A listing `owner` owns — the row every rule below acts on. */
  const listedByOwner = async (): Promise<string> =>
    (await service.create(OWNER_ID, input)).id;

  beforeEach(async () => {
    listingRepository = new FakeListingRepository();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ListingService,
        { provide: ListingRepository, useValue: listingRepository },
      ],
    }).compile();

    service = moduleRef.get(ListingService);
  });

  it("takes the owner from the session rather than from the body", async () => {
    const listing = await service.create(OWNER_ID, input);

    expect(listing).toMatchObject({ ...input, ownerId: OWNER_ID });
  });

  it("scopes an owner's dashboard to their own listings", async () => {
    await listedByOwner();
    await service.create(OTHER_OWNER_ID, input);

    await expect(service.findAll()).resolves.toHaveLength(2);
    await expect(service.findByOwner(OWNER_ID)).resolves.toMatchObject([
      { ownerId: OWNER_ID },
    ]);
  });

  it("lets the owner edit their listing", async () => {
    const id = await listedByOwner();

    await expect(
      service.update(id, { capacity: 6 }, owner),
    ).resolves.toMatchObject({ id, capacity: 6 });
  });

  it("refuses an owner who does not own the listing", async () => {
    const id = await listedByOwner();

    await expect(
      service.update(id, { capacity: 6 }, otherOwner),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.remove(id, otherOwner)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.findOne(id)).resolves.toMatchObject({
      capacity: input.capacity,
    });
  });

  it("lets an admin edit and delete a listing they do not own", async () => {
    const id = await listedByOwner();

    await expect(
      service.update(id, { capacity: 6 }, admin),
    ).resolves.toMatchObject({ id });

    await service.remove(id, admin);
    expect(listingRepository.rows.size).toBe(0);
  });

  it("deletes a listing nothing is booked against", async () => {
    const id = await listedByOwner();

    await service.remove(id, owner);

    expect(listingRepository.rows.size).toBe(0);
  });

  it("answers 409 rather than taking somebody's booking down with the listing", async () => {
    const id = await listedByOwner();

    listingRepository.bookings.set(id, 2);

    await expect(service.remove(id, owner)).rejects.toThrow(ConflictException);
    expect(listingRepository.rows.size).toBe(1);
  });

  it("answers 409, not 500, when a stay is booked between the count and the delete", async () => {
    const id = await listedByOwner();

    listingRepository.bookedDuringDelete = true;

    await expect(service.remove(id, owner)).rejects.toThrow(ConflictException);
  });

  it("answers 404 when the listing is deleted just before the write", async () => {
    const id = await listedByOwner();

    listingRepository.vanishingListing = true;

    await expect(service.update(id, { capacity: 6 }, owner)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.remove(id, owner)).rejects.toThrow(NotFoundException);
  });

  it("throws NotFoundException for an unknown id, before any ownership check", async () => {
    await expect(service.findOne(UNKNOWN_ID)).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.update(UNKNOWN_ID, { capacity: 6 }, otherOwner),
    ).rejects.toThrow(NotFoundException);
  });
});
