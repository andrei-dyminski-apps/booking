import { Injectable } from "@nestjs/common";
import {
  MAX_WAITLIST_ENTRIES,
  type JoinWaitlistInput,
  type WaitlistDemandEntry,
  type WaitlistDemandQuery,
  type WaitlistEntry,
  type WaitlistSort,
} from "@repo/contracts";
import {
  holdsTheSlot,
  overlapping,
} from "../booking/infrastructure/booking.repository";
import { afterCreatedAt, CREATED_AT_ORDER, type Page } from "../common/paging";
import type {
  Listing as ListingRow,
  Prisma,
  WaitlistEntry as WaitlistEntryRow,
} from "../generated/prisma/client";
import { STILL_OFFERED } from "../listing/listing.repository";
import { startOfToday, toIsoDate } from "../prisma/iso-date";
import { PrismaService } from "../prisma/prisma.service";
import type { WaitlistCursor } from "./waitlist-cursor";
import type { FreedNights, WaitingEntry } from "./waitlist.types";

/** The listing is gone, retired, or was never there — the `404` a booking gets. */
export class WaitlistListingNotFoundError extends Error {
  constructor(listingId: string) {
    super(`Listing ${listingId} not found`);
    this.name = "WaitlistListingNotFoundError";
  }
}

/** Nobody waits for their own nights — the `403` a booking of one's own listing gets. */
export class WaitlistOwnListingError extends Error {
  constructor(listingId: string) {
    super(`Listing ${listingId} is your own`);
    this.name = "WaitlistOwnListingError";
  }
}

/**
 * The account behind the token is gone — read under the same lock the cap is counted
 * under, so it costs no query of its own. See `GuestNotFoundError` for why that is a `401`.
 */
export class WaiterNotFoundError extends Error {
  constructor(userId: string) {
    super(`User ${userId} not found`);
    this.name = "WaiterNotFoundError";
  }
}

/** Nothing holds these nights right now, so there is nothing to wait for. */
export class NightsAvailableError extends Error {
  constructor(input: JoinWaitlistInput) {
    super(
      `Listing ${input.listingId} is free from ${input.from} to ${input.to} — book it instead`,
    );
    this.name = "NightsAvailableError";
  }
}

/** The only stays holding these nights are the caller's own — there is nobody to wait for. */
export class WaiterHoldsNightsError extends Error {
  constructor(input: JoinWaitlistInput) {
    super(
      `You already hold listing ${input.listingId} from ${input.from} to ${input.to}`,
    );
    this.name = "WaiterHoldsNightsError";
  }
}

/** The account is waiting for as many ranges as `MAX_WAITLIST_ENTRIES` allows. */
export class WaitlistFullError extends Error {
  constructor() {
    super(
      `You are already waiting for ${String(MAX_WAITLIST_ENTRIES)} date ranges — leave one first`,
    );
    this.name = "WaitlistFullError";
  }
}

/** The rows of the two `FOR UPDATE` reads — raw SQL, so the columns keep their stored names. */
type LockedListing = { id: string; owner_id: string; deleted_at: Date | null };
type LockedUser = { id: string };
type ClaimedEntry = { id: string };

/** What an entry is answered with — the summary every booking carries, for the same reason. */
const LISTING_SUMMARY = {
  listing: { select: { title: true, pricePerNight: true } },
} satisfies Prisma.WaitlistEntryInclude;

type WaitlistEntryRowWithListing = WaitlistEntryRow & {
  listing: Pick<ListingRow, "title" | "pricePerNight">;
};

/** The waiter beside the listing — read for an admin only, see `waiterSchema`. */
const WITH_WAITER = {
  ...LISTING_SUMMARY,
  user: { select: { id: true, name: true } },
} satisfies Prisma.WaitlistEntryInclude;

/**
 * The entries and the one question about bookings they need answered: whether a range is
 * held by anybody. That question is a `where` over `bookings`, imported from
 * `BookingRepository` (`holdsTheSlot`, `overlapping`) rather than restated, so a waitlist
 * and the transaction that refuses a booking cannot disagree about what "taken" means —
 * the same crossing the catalogue's date filter makes. The module therefore needs nothing
 * of `BookingModule`, which is what lets that module depend on this one.
 */
@Injectable()
export class WaitlistRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * One transaction, and the two locks are what make each rule in it hold:
   *
   *  1. the listing row, `FOR UPDATE` — the lock `BookingRepository.create` takes, so the
   *     "is it taken" read below cannot interleave with a booking or a lapsing hold being
   *     replaced on the same listing. `deleted_at` and `owner_id` are read under it, as
   *     the booking reads them;
   *  2. the caller's own row — which serialises two joins of one account, so the cap and
   *     the duplicate check are counted against what the other one wrote, and which reads
   *     whether the account still exists.
   *
   * Then: the caller's ranges whose check-in has passed are deleted (nothing can book them
   * any more, and they would count against the cap), the same range is answered as it is
   * if the caller is already waiting for it, the cap is applied, a free range is refused,
   * and the entry is written.
   *
   * The cap counts what `findFor` shows: an entry on a retired listing is never told and
   * cannot be seen to be left, so it must not take a place either. A range held only by
   * the caller's own stays is refused as well — nobody else is there to let it go.
   */
  async join(userId: string, input: JoinWaitlistInput): Promise<WaitlistEntry> {
    const now = new Date();
    const from = new Date(input.from);
    const to = new Date(input.to);

    return this.prismaService.$transaction(async (tx) => {
      const [listing] = await tx.$queryRaw<LockedListing[]>`
        SELECT id, owner_id, deleted_at FROM listings WHERE id = ${input.listingId}::uuid FOR UPDATE
      `;

      if (listing === undefined || listing.deleted_at !== null) {
        throw new WaitlistListingNotFoundError(input.listingId);
      }

      if (listing.owner_id === userId) {
        throw new WaitlistOwnListingError(input.listingId);
      }

      const [user] = await tx.$queryRaw<LockedUser[]>`
        SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE
      `;

      if (user === undefined) {
        throw new WaiterNotFoundError(userId);
      }

      await tx.waitlistEntry.deleteMany({
        where: { userId, from: { lt: startOfToday(now) } },
      });

      const existing = await tx.waitlistEntry.findFirst({
        where: { userId, listingId: input.listingId, from, to },
        include: LISTING_SUMMARY,
      });

      if (existing !== null) return toWaitlistEntry(existing);

      if (
        (await tx.waitlistEntry.count({
          where: { userId, listing: STILL_OFFERED },
        })) >= MAX_WAITLIST_ENTRIES
      ) {
        throw new WaitlistFullError();
      }

      const holders = await tx.booking.findMany({
        where: {
          listingId: input.listingId,
          ...holdsTheSlot(now),
          ...overlapping(input.from, input.to),
        },
        select: { guestId: true },
      });

      if (holders.length === 0) {
        throw new NightsAvailableError(input);
      }

      if (holders.every(({ guestId }) => guestId === userId)) {
        throw new WaiterHoldsNightsError(input);
      }

      const row = await tx.waitlistEntry.create({
        data: { listingId: input.listingId, userId, from, to },
        include: LISTING_SUMMARY,
      });

      return toWaitlistEntry(row);
    });
  }

  /**
   * The caller's ranges still ahead, the earliest check-in first. Bounded by the cap, so it
   * is answered whole. A retired listing's entries are left out, as the listing is from
   * every other read that offers it.
   */
  async findFor(userId: string): Promise<WaitlistEntry[]> {
    const rows = await this.prismaService.waitlistEntry.findMany({
      where: {
        userId,
        from: { gte: startOfToday(new Date()) },
        listing: STILL_OFFERED,
      },
      include: LISTING_SUMMARY,
      orderBy: [{ from: "asc" }, { id: "asc" }],
    });

    return rows.map(toWaitlistEntry);
  }

  /** Every entry on the site, with who waits — the admin's scope. */
  async findPageForEveryone(
    query: WaitlistDemandQuery,
    cursor: WaitlistCursor | null,
  ): Promise<Page<WaitlistDemandEntry>> {
    const rows = await this.prismaService.waitlistEntry.findMany({
      ...demandPage({}, query, cursor),
      include: WITH_WAITER,
    });

    return {
      items: rows
        .slice(0, query.limit)
        .map((row) => ({ ...toWaitlistEntry(row), waiter: row.user })),
      hasMore: rows.length > query.limit,
    };
  }

  /**
   * The entries on this owner's listings, and not who made them. A relation rather than a
   * column, so no index of this table seeks it — bounded by the owner's own listings, the
   * trade the owner's page of stays makes.
   */
  async findPageForListingOwner(
    ownerId: string,
    query: WaitlistDemandQuery,
    cursor: WaitlistCursor | null,
  ): Promise<Page<WaitlistDemandEntry>> {
    const rows = await this.prismaService.waitlistEntry.findMany({
      ...demandPage({ listing: { ownerId } }, query, cursor),
      include: LISTING_SUMMARY,
    });

    return {
      items: rows
        .slice(0, query.limit)
        .map((row) => ({ ...toWaitlistEntry(row), waiter: null })),
      hasMore: rows.length > query.limit,
    };
  }

  /**
   * Scoped by the owner in the `where`, so somebody else's id deletes nothing and answers
   * `false` — the `404` of a row the caller cannot see, without a read first.
   */
  async leave(userId: string, id: string): Promise<boolean> {
    const { count } = await this.prismaService.waitlistEntry.deleteMany({
      where: { id, userId },
    });

    return count > 0;
  }

  /**
   * The entries whose nights these freed nights touch and which are free now as a whole —
   * the other nights of a longer range may still be held by somebody else, and an entry is
   * only news once all of it can be booked. On a listing still offered, with a check-in
   * still ahead.
   *
   * Two reads whatever the number of candidates: the entries, then every stay still holding
   * a night anywhere in the span they cover together — through `holdsTheSlot` and
   * `overlapping`, so "taken" means what it means to the booking transaction. Which of
   * those stays touches which entry is then the same half-open comparison over the rows,
   * because Prisma cannot compare a relation's columns to the parent's.
   *
   * The read takes no lock, and needs none: what it answers is a hint. A booking taken
   * between this read and the notice makes the notice a little late, and its reader is
   * refused by the booking's own transaction like anybody else.
   */
  async findNowFree(freed: FreedNights): Promise<WaitingEntry[]> {
    const now = new Date();
    // `AND`-ed rather than spread: the overlap names `from` too, and spread it would
    // replace the check-in bound — the reason `demandPage` gives.
    const candidates = await this.prismaService.waitlistEntry.findMany({
      where: {
        AND: [
          {
            listingId: freed.listingId,
            from: { gte: startOfToday(now) },
            listing: STILL_OFFERED,
          },
          overlappingEntries(freed.from, freed.to),
        ],
      },
      include: { listing: { select: { title: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    if (candidates.length === 0) return [];

    const spanFrom = Math.min(...candidates.map((row) => row.from.getTime()));
    const spanTo = Math.max(...candidates.map((row) => row.to.getTime()));
    const held = await this.prismaService.booking.findMany({
      where: {
        listingId: freed.listingId,
        ...holdsTheSlot(now),
        ...overlapping(
          toIsoDate(new Date(spanFrom)),
          toIsoDate(new Date(spanTo)),
        ),
      },
      select: { from: true, to: true },
    });

    return candidates
      .filter(
        (row) => !held.some((stay) => stay.from < row.to && row.from < stay.to),
      )
      .map((row) => ({
        id: row.id,
        userId: row.userId,
        nights: {
          listingId: row.listingId,
          listingTitle: row.listing.title,
          from: toIsoDate(row.from),
          to: toIsoDate(row.to),
        },
      }));
  }

  /**
   * Takes entries off the list for good, and answers the ones this call was the one to
   * take: of two releases racing over one entry, only the one whose `DELETE` matched it may
   * tell its owner, so the notice cannot go out twice. Raw SQL for the `RETURNING`, which
   * Prisma's `deleteMany` does not offer — one statement for every entry of a release.
   */
  async claim(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();

    const claimed = await this.prismaService.$queryRaw<ClaimedEntry[]>`
      DELETE FROM waitlist_entries WHERE id = ANY(${ids}::uuid[]) RETURNING id
    `;

    return new Set(claimed.map(({ id }) => id));
  }
}

/**
 * A page of the waitlist on somebody's listings: the scope, the entries still ahead on a
 * listing still offered — what the caller's own list shows of theirs — and the cursor,
 * `AND`-ed for the reason `BookingRepository.findPage` gives, with `limit + 1` rows so the
 * caller learns whether another page follows. The cursor compares values rather than
 * resolving a row by id: an entry is deleted the moment its waiter is told, which may be
 * between two pages.
 */
function demandPage(
  scope: Prisma.WaitlistEntryWhereInput,
  query: WaitlistDemandQuery,
  cursor: WaitlistCursor | null,
): Pick<Prisma.WaitlistEntryFindManyArgs, "where" | "orderBy" | "take"> {
  return {
    where: {
      AND: [
        scope,
        { from: { gte: startOfToday(new Date()) }, listing: STILL_OFFERED },
        ...(cursor === null ? [] : [afterCursor(cursor)]),
      ],
    },
    orderBy: DEMAND_ORDER_BY[query.sort],
    take: query.limit + 1,
  };
}

/** The tiebreaker follows the key, so each ordering is one index read — see the model. */
const DEMAND_ORDER_BY: Record<
  WaitlistSort,
  Prisma.WaitlistEntryOrderByWithRelationInput[]
> = {
  newest: CREATED_AT_ORDER.newest,
  checkInAsc: [{ from: "asc" }, { id: "asc" }],
};

/** Past the cursor row, the key said twice for the reason `afterCursor` in `booking.repository.ts` gives. */
function afterCursor(cursor: WaitlistCursor): Prisma.WaitlistEntryWhereInput {
  switch (cursor.sort) {
    case "newest":
      return afterCreatedAt(cursor);
    case "checkInAsc":
      return {
        from: { gte: cursor.from },
        OR: [
          { from: { gt: cursor.from } },
          { from: cursor.from, id: { gt: cursor.id } },
        ],
      };
  }
}

/** The half-open overlap of `overlapping`, over this table's columns of the same name. */
function overlappingEntries(
  from: string,
  to: string,
): Prisma.WaitlistEntryWhereInput {
  return { from: { lt: new Date(to) }, to: { gt: new Date(from) } };
}

function toWaitlistEntry(row: WaitlistEntryRowWithListing): WaitlistEntry {
  return {
    id: row.id,
    listingId: row.listingId,
    listing: {
      title: row.listing.title,
      pricePerNight: row.listing.pricePerNight.toNumber(),
    },
    from: toIsoDate(row.from),
    to: toIsoDate(row.to),
    createdAt: row.createdAt.toISOString(),
  };
}
