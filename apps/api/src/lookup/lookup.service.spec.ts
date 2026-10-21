import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  LookupKind,
  Role,
  StayParty,
  type LookupOption,
  type LookupQuery,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { Page } from "../common/paging";
import { encodeCursor, type LookupCursor } from "./lookup-cursor";
import { LookupRepository } from "./lookup.repository";
import { LookupService } from "./lookup.service";

const OWNER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const OTHER_OWNER_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";

const admin: AuthenticatedUser = {
  id: "0b6f7f6e-2f4c-4a52-9a5e-8f1f6d2c3b4a",
  email: "admin@example.com",
  role: Role.ADMIN,
};

const owner: AuthenticatedUser = {
  id: OWNER_ID,
  email: "owner@example.com",
  role: Role.USER,
};

const guest: AuthenticatedUser = {
  id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
  email: "guest@example.com",
  role: Role.USER,
};

const query = (over: Partial<LookupQuery> = {}): LookupQuery => ({
  q: "exa",
  side: StayParty.GUEST,
  limit: 20,
  ...over,
});

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
type PublicOf<T> = { [K in keyof T]: T[K] };

/** A row a lookup can return, and whose stays — by owner and by guest — name it. */
type Row = { option: LookupOption; stayOwners: string[]; guests: string[] };

/**
 * Rows in memory, narrowed by the scope each named method stands for and paged by the
 * name — the shape the service reasons about. The search itself and the indexes are the
 * e2e spec's half.
 */
class FakeLookupRepository implements PublicOf<LookupRepository> {
  readonly owners: LookupOption[] = [];
  readonly guests: Row[] = [];
  readonly listings: Row[] = [];

  findOwners(
    q: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    return page(this.owners, q, cursor);
  }

  findGuestsOfEveryone(
    q: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    return page(
      this.guests.map((row) => row.option),
      q,
      cursor,
    );
  }

  findGuestsOfListingOwner(
    ownerId: string,
    q: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    return page(ofOwner(this.guests, ownerId), q, cursor);
  }

  findListingsOfEveryone(
    q: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    return page(
      this.listings.map((row) => row.option),
      q,
      cursor,
    );
  }

  findListingsOfListingOwner(
    ownerId: string,
    q: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    return page(ofOwner(this.listings, ownerId), q, cursor);
  }

  findListingsOfGuest(
    guestId: string,
    q: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    return page(
      this.listings
        .filter((row) => row.guests.includes(guestId))
        .map((row) => row.option),
      q,
      cursor,
    );
  }
}

function ofOwner(rows: Row[], ownerId: string): LookupOption[] {
  return rows
    .filter((row) => row.stayOwners.includes(ownerId))
    .map((row) => row.option);
}

function page(
  options: LookupOption[],
  q: LookupQuery,
  cursor: LookupCursor | null,
): Promise<Page<LookupOption>> {
  const after = [...options]
    .sort((a, b) => a.label.localeCompare(b.label))
    .filter((option) => cursor === null || option.label > cursor.label);

  return Promise.resolve({
    items: after.slice(0, q.limit),
    hasMore: after.length > q.limit,
  });
}

const option = (label: string): LookupOption => ({
  id: crypto.randomUUID(),
  label,
  hint: null,
});

describe("LookupService", () => {
  let service: LookupService;
  let repository: FakeLookupRepository;

  beforeEach(async () => {
    repository = new FakeLookupRepository();

    const moduleRef = await Test.createTestingModule({
      providers: [
        LookupService,
        { provide: LookupRepository, useValue: repository },
      ],
    }).compile();

    service = moduleRef.get(LookupService);
  });

  describe("the scope of the lookups over stays", () => {
    beforeEach(() => {
      repository.guests.push(
        {
          option: option("mine@example.com"),
          stayOwners: [OWNER_ID],
          guests: [],
        },
        {
          option: option("theirs@example.com"),
          stayOwners: [OTHER_OWNER_ID],
          guests: [],
        },
      );
      repository.listings.push(
        { option: option("My flat"), stayOwners: [OWNER_ID], guests: [] },
        {
          option: option("Their flat"),
          stayOwners: [OTHER_OWNER_ID],
          guests: [guest.id],
        },
      );
    });

    it("offers an owner the guests and the listings of their own stays only", async () => {
      const guests = await service.guests(owner, query());
      const listings = await service.listings(
        owner,
        query({ side: StayParty.HOST }),
      );

      expect(guests.items.map((item) => item.label)).toEqual([
        "mine@example.com",
      ]);
      expect(listings.items.map((item) => item.label)).toEqual(["My flat"]);
    });

    it("offers an admin those of everybody's stays", async () => {
      const guests = await service.guests(admin, query());
      const listings = await service.listings(admin, query());

      expect(guests.items).toHaveLength(2);
      expect(listings.items).toHaveLength(2);
    });

    it("offers a guest the listings they stayed in, and an empty page of guests", async () => {
      const listings = await service.listings(guest, query());
      const guests = await service.guests(guest, query());

      expect(listings.items.map((item) => item.label)).toEqual(["Their flat"]);
      expect(guests).toEqual({ items: [], nextCursor: null });
    });

    it("offers an account that also hosts the listings of the side it asks for", async () => {
      repository.guests.push({
        option: option("visitor@example.com"),
        stayOwners: [guest.id],
        guests: [],
      });
      repository.listings.push({
        option: option("Spare room"),
        stayOwners: [guest.id],
        guests: [],
      });

      const labels = async (side: StayParty): Promise<string[]> =>
        (await service.listings(guest, query({ side }))).items.map(
          (item) => item.label,
        );

      await expect(labels(StayParty.GUEST)).resolves.toEqual(["Their flat"]);
      await expect(labels(StayParty.HOST)).resolves.toEqual(["Spare room"]);
      expect(
        (await service.guests(guest, query())).items.map((item) => item.label),
      ).toEqual(["visitor@example.com"]);
    });
  });

  describe("paging", () => {
    beforeEach(() => {
      repository.owners.push(
        option("a@example.com"),
        option("b@example.com"),
        option("c@example.com"),
      );
    });

    it("issues a cursor while there is more, and continues from it", async () => {
      const first = await service.owners(query({ limit: 2 }));

      expect(first.items.map((item) => item.label)).toEqual([
        "a@example.com",
        "b@example.com",
      ]);
      expect(first.nextCursor).not.toBeNull();

      const second = await service.owners(
        query({ limit: 2, cursor: first.nextCursor ?? undefined }),
      );

      expect(second.items.map((item) => item.label)).toEqual(["c@example.com"]);
      expect(second.nextCursor).toBeNull();
    });

    it("refuses a cursor it cannot read", async () => {
      await expect(
        service.owners(query({ cursor: "not-a-cursor" })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("refuses a cursor another lookup issued", async () => {
      const cursor = encodeCursor(LookupKind.guests, option("a@example.com"));

      await expect(service.owners(query({ cursor }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
