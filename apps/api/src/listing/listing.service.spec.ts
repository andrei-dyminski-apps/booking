import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  Role,
  type BookedRange,
  type CreateListingInput,
  type Listing,
  type ListingDetail,
  type ListingPricing,
  type ListingQuery,
  type UpdateListingInput,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { BookingRepository } from "../booking/booking.repository";
import type { Page } from "../common/paging";
import { decodeCursor, type CatalogueCursor } from "./catalogue-cursor";
import { ListingRepository } from "./listing.repository";
import { ListingService } from "./listing.service";

const OWNER_ID = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";
const OTHER_OWNER_ID = "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f50";
const UNKNOWN_ID = "0b6f7f6e-2f4c-4a52-9a5e-8f1f6d2c3b4a";

const input: CreateListingInput = {
  title: "Loft above the harbour",
  description: "Two rooms under the roof and a wall of glass facing the water.",
  pricePerNight: 120,
  capacity: 4,
};

/** What a listing created without exceptions to its price has: none of either kind. */
const NO_EXCEPTIONS: ListingPricing = { weekdays: {}, dates: [] };

const weekendPricing: ListingPricing = {
  weekdays: { fri: 150, sat: 160 },
  dates: [{ date: "2099-12-31", price: 400 }],
};

/** The whole of a catalogue query, so a test names only the part it is about. */
const query = (over: Partial<ListingQuery> = {}): ListingQuery => ({
  limit: 20,
  sort: "newest",
  ...over,
});

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
   * The exceptions to each listing's price, apart from the row: they are a table of their
   * own in storage, and a `Listing` answered by a write does not carry them.
   */
  readonly pricing = new Map<string, ListingPricing>();

  /**
   * Set to have a write lose the race against a retirement the read before it could not
   * see.
   */
  vanishingListing = false;

  /**
   * The filters, the ordering and the keyset comparison are the repository's and are
   * covered by e2e against a real database. What the service decides about a page is the
   * cursor — whether one is issued and what an unreadable one costs — so that is all this
   * models: rows in the order they were created, walked from the one the cursor names.
   */
  findPage(
    query: ListingQuery,
    cursor: CatalogueCursor | null,
  ): Promise<Page<Listing>> {
    const offered = this.offered();
    const start =
      cursor === null
        ? 0
        : offered.findIndex((listing) => listing.id === cursor.id) + 1;

    return Promise.resolve({
      items: offered.slice(start, start + query.limit),
      hasMore: start + query.limit < offered.length,
    });
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

  findDetailById(id: string): Promise<ListingDetail | null> {
    const stored = this.rows.get(id);

    return Promise.resolve(
      stored === undefined || this.retired.has(id)
        ? null
        : { ...stored, pricing: this.pricing.get(id) ?? NO_EXCEPTIONS },
    );
  }

  create(ownerId: string, listing: CreateListingInput): Promise<Listing> {
    const { pricing, ...fields } = listing;
    const stored: Listing = {
      // Shaped like the real thing: a cursor carries the id and refuses one that is not a
      // uuid, so `listing-1` would make this fake unable to page.
      id: `00000000-0000-4000-8000-${String(this.rows.size + 1).padStart(12, "0")}`,
      ownerId,
      ...fields,
      createdAt: "2026-08-20T12:00:00.000Z",
      updatedAt: "2026-08-20T12:00:00.000Z",
    };

    this.rows.set(stored.id, stored);
    this.pricing.set(stored.id, pricing ?? NO_EXCEPTIONS);

    return Promise.resolve(stored);
  }

  update(id: string, listing: UpdateListingInput): Promise<Listing | null> {
    const stored = this.rows.get(id);

    if (stored === undefined || this.retired.has(id) || this.vanishingListing) {
      return Promise.resolve(null);
    }

    const { pricing, ...fields } = listing;
    const updated: Listing = {
      ...stored,
      ...fields,
      updatedAt: "2026-08-21T12:00:00.000Z",
    };

    this.rows.set(id, updated);

    // Replaced whole, never merged: see `pricing` on `createListingSchema`.
    if (pricing !== undefined) this.pricing.set(id, pricing);

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

/**
 * `ListingService` reaches one method of the booking repository and nothing else, so the
 * fake declares exactly that much: what the ranges mean, and the query that finds them,
 * belong to the module that owns the rows.
 */
class FakeBookingRepository implements Pick<
  PublicOf<BookingRepository>,
  "findActiveRanges"
> {
  booked: BookedRange[] = [];

  findActiveRanges(): Promise<BookedRange[]> {
    return Promise.resolve(this.booked);
  }
}

describe("ListingService", () => {
  let service: ListingService;
  let listingRepository: FakeListingRepository;
  let bookingRepository: FakeBookingRepository;

  /** A listing `owner` owns — the row every rule below acts on. */
  const listedByOwner = async (): Promise<string> =>
    (await service.create(OWNER_ID, input)).id;

  beforeEach(async () => {
    listingRepository = new FakeListingRepository();
    bookingRepository = new FakeBookingRepository();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ListingService,
        { provide: ListingRepository, useValue: listingRepository },
        { provide: BookingRepository, useValue: bookingRepository },
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

    await expect(service.findPage(query())).resolves.toMatchObject({
      items: [{ ownerId: OWNER_ID }, { ownerId: OTHER_OWNER_ID }],
      nextCursor: null,
    });
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

    await expect(service.findPage(query())).resolves.toMatchObject({
      items: [],
    });
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

  it("issues a cursor while there is another page, and none on the last one", async () => {
    const first = await service.create(OWNER_ID, input);
    const second = await service.create(OWNER_ID, input);

    const page = await service.findPage(query({ limit: 1 }));

    expect(page.items).toMatchObject([{ id: first.id }]);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(String(page.nextCursor))).toEqual({
      sort: "newest",
      createdAt: new Date(first.createdAt),
      id: first.id,
    });

    await expect(
      service.findPage(query({ limit: 1, cursor: String(page.nextCursor) })),
    ).resolves.toMatchObject({ items: [{ id: second.id }], nextCursor: null });
  });

  /**
   * The ordering itself belongs to the repository and is covered by e2e; what the service
   * decides is which key the cursor it hands back is made of. So the row the fake ends the
   * page on carries a price of its own — a cursor built from `input` would read the same
   * whether the service asked for the price or fell back to the timestamp.
   */
  it("issues a cursor made of the key the ordering sorts by", async () => {
    const first = await service.create(OWNER_ID, {
      ...input,
      pricePerNight: 1,
    });
    await service.create(OWNER_ID, input);

    const page = await service.findPage(query({ limit: 1, sort: "priceAsc" }));

    expect(first.pricePerNight).not.toBe(input.pricePerNight);
    expect(decodeCursor(String(page.nextCursor))).toEqual({
      sort: "priceAsc",
      pricePerNight: first.pricePerNight,
      id: first.id,
    });
  });

  // A client can only ever hand back a cursor this API issued, so a broken one is a
  // mistake worth naming rather than a silent first page.
  it("refuses a cursor it did not issue", async () => {
    await expect(
      service.findPage(query({ cursor: "not-a-cursor" })),
    ).rejects.toThrow(BadRequestException);
  });

  /**
   * A cursor names a place in one ordering, so it says nothing about any other. Reading it
   * against a different `sort` would return rows that are a page of neither list —
   * changing what the catalogue is ordered by starts the pages again, and that is what the
   * refusal tells the client to do.
   */
  it("refuses a cursor issued under a different ordering", async () => {
    await service.create(OWNER_ID, input);
    await service.create(OWNER_ID, input);

    const page = await service.findPage(query({ limit: 1 }));

    await expect(
      service.findPage(
        query({ limit: 1, sort: "priceAsc", cursor: String(page.nextCursor) }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("reports the nights a listing is taken for, and hides a retired one entirely", async () => {
    const id = await listedByOwner();
    const window = { from: "2026-09-01", to: "2026-09-30" };

    bookingRepository.booked = [{ from: "2026-09-10", to: "2026-09-14" }];

    await expect(service.availability(id, window)).resolves.toEqual({
      listingId: id,
      ...window,
      booked: [{ from: "2026-09-10", to: "2026-09-14" }],
    });

    await service.remove(id, owner);

    await expect(service.availability(id, window)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("answers one listing with the exceptions to its price, and none for one created without", async () => {
    const plain = await listedByOwner();
    const priced = (
      await service.create(OWNER_ID, { ...input, pricing: weekendPricing })
    ).id;

    await expect(service.findOne(plain)).resolves.toMatchObject({
      pricePerNight: input.pricePerNight,
      pricing: NO_EXCEPTIONS,
    });
    await expect(service.findOne(priced)).resolves.toMatchObject({
      pricing: weekendPricing,
    });
  });

  it("replaces the prices on an edit that carries them, and keeps them on one that does not", async () => {
    const id = (
      await service.create(OWNER_ID, { ...input, pricing: weekendPricing })
    ).id;

    await service.update(id, { capacity: 6 }, owner);
    await expect(service.findOne(id)).resolves.toMatchObject({
      pricing: weekendPricing,
    });

    const fridaysOnly: ListingPricing = { weekdays: { fri: 140 }, dates: [] };

    await service.update(id, { pricing: fridaysOnly }, owner);
    await expect(service.findOne(id)).resolves.toMatchObject({
      capacity: 6,
      pricing: fridaysOnly,
    });
  });

  it("refuses to change the prices of somebody else's listing", async () => {
    const id = await listedByOwner();

    await expect(
      service.update(id, { pricing: weekendPricing }, otherOwner),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.findOne(id)).resolves.toMatchObject({
      pricing: NO_EXCEPTIONS,
    });
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
