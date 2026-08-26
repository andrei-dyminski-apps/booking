import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  Role,
  type CreateListingInput,
  type Listing,
  type UpdateListingInput,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ListingRepository } from "./listing.repository";
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
  /** Every row the table holds, the retired ones included — storage, not the catalogue. */
  readonly rows = new Map<string, Listing>();

  /** The ids `softDelete` has stamped: still stored, no longer offered to anybody. */
  readonly retired = new Set<string>();

  /**
   * Set to have a write lose the race against a retirement the read before it could not
   * see.
   */
  vanishingListing = false;

  findAll(): Promise<Listing[]> {
    return Promise.resolve(this.offered());
  }

  findByOwner(ownerId: string): Promise<Listing[]> {
    return Promise.resolve(
      this.offered().filter((listing) => listing.ownerId === ownerId),
    );
  }

  findById(id: string): Promise<Listing | null> {
    const stored = this.rows.get(id);

    return Promise.resolve(
      stored === undefined || this.retired.has(id) ? null : stored,
    );
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

    if (stored === undefined || this.retired.has(id) || this.vanishingListing) {
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

  softDelete(id: string): Promise<boolean> {
    if (!this.rows.has(id) || this.retired.has(id) || this.vanishingListing) {
      return Promise.resolve(false);
    }

    this.retired.add(id);

    return Promise.resolve(true);
  }

  private offered(): Listing[] {
    return [...this.rows.values()].filter(
      (listing) => !this.retired.has(listing.id),
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
    await expect(service.findOne(id)).rejects.toThrow(NotFoundException);
  });

  it("retires the listing instead of deleting the row a stay would point at", async () => {
    const id = await listedByOwner();

    await service.remove(id, owner);

    expect(listingRepository.rows.has(id)).toBe(true);
    expect(listingRepository.retired.has(id)).toBe(true);
  });

  it("takes a retired listing out of the catalogue and its owner's dashboard", async () => {
    const id = await listedByOwner();

    await service.remove(id, owner);

    await expect(service.findAll()).resolves.toHaveLength(0);
    await expect(service.findByOwner(OWNER_ID)).resolves.toHaveLength(0);
    await expect(service.findOne(id)).rejects.toThrow(NotFoundException);
  });

  it("refuses to edit or retire a listing that is already retired", async () => {
    const id = await listedByOwner();

    await service.remove(id, owner);

    await expect(service.update(id, { capacity: 6 }, owner)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.remove(id, owner)).rejects.toThrow(NotFoundException);
  });

  it("answers 404 when the listing is retired just before the write", async () => {
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
