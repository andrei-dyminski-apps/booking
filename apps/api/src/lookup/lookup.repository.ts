import { Injectable } from "@nestjs/common";
import type { LookupOption, LookupQuery } from "@repo/contracts";
import { againstListingsOf } from "../booking/booking.repository";
import type { Page } from "../common/paging";
import type { Prisma } from "../generated/prisma/client";
import { STILL_OFFERED } from "../listing/listing.repository";
import { escapeLike } from "../prisma/escape-like";
import { PrismaService } from "../prisma/prisma.service";
import type { LookupCursor } from "./lookup-cursor";
import { lookupConditions, toLookupPage } from "./lookup-page";

/**
 * The queries behind the filter boxes: accounts by their address and listings by their
 * title, each narrowed to the rows the list beside the box can actually show — a
 * suggestion that empties the list by construction is a box that lies.
 *
 * The rows leave as a `LookupOption`, a shape of this module's own: only the id and the
 * name a person picks it by. Both tables are read here rather than through the repository
 * each belongs to, because a lookup is a query of its own — two columns, a search and a
 * keyset — and nothing of the row mapping those repositories keep. Listings could not be
 * read there in any case: the lookup offers retired ones, and every read of
 * `ListingRepository` is narrowed to what is still on offer. What crosses in is the
 * `where` of other repositories — `STILL_OFFERED` and `againstListingsOf` — so "on offer"
 * and "an owner's stays" keep the one definition they already have.
 *
 * Every lookup is a named method rather than a `where` handed in by the service, for the
 * reason `BookingRepository` gives its three scopes: a role the service does not handle
 * reaches no query at all, instead of an unscoped one.
 */
@Injectable()
export class LookupRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /** The accounts with a listing on offer — what the admin's `?ownerId=` can match. */
  findOwners(
    query: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    return this.findAccounts(
      { listings: { some: STILL_OFFERED } },
      query,
      cursor,
    );
  }

  /** Every account that ever took a stay — an admin's `?guestId=` reads them all. */
  findGuestsOfEveryone(
    query: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    return this.findAccounts({ bookings: { some: {} } }, query, cursor);
  }

  /** The accounts that took a stay against one of this owner's listings. */
  findGuestsOfListingOwner(
    ownerId: string,
    query: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    return this.findAccounts(
      { bookings: { some: againstListingsOf(ownerId) } },
      query,
      cursor,
    );
  }

  /**
   * Every listing a stay was taken against. **Retired ones included**, deliberately and
   * unlike every read of `ListingRepository`: the stays outlive the listing they name —
   * that is what the row was kept for — so a list of stays can be filtered by one, and the
   * box has to be able to offer it.
   */
  findListingsOfEveryone(
    query: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    return this.findListings({ bookings: { some: {} } }, query, cursor);
  }

  /** The listings this guest stayed in, retired ones included for the same reason. */
  findListingsOfGuest(
    guestId: string,
    query: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    return this.findListings(
      { bookings: { some: { guestId } } },
      query,
      cursor,
    );
  }

  /** This owner's listings with a stay against them, retired ones included for the same reason. */
  findListingsOfListingOwner(
    ownerId: string,
    query: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    return this.findListings(
      { bookings: { some: againstListingsOf(ownerId) } },
      query,
      cursor,
    );
  }

  /**
   * Accounts by a part of their address. The search is case-sensitive for the reason
   * `userFilters` in `user.repository.ts` gives — every stored address is lower-case, so
   * the term is lower-cased instead of the column — and `users_email_trgm_idx` serves it.
   * The order is the unique btree of `email` read forwards.
   */
  private async findAccounts(
    scope: Prisma.UserWhereInput,
    query: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    const rows = await this.prismaService.user.findMany({
      where: {
        AND: [
          scope,
          ...lookupConditions(
            (email, id): Prisma.UserWhereInput => ({ email, id }),
            { contains: escapeLike(query.q.toLowerCase()) },
            query,
            cursor,
          ),
        ],
      },
      orderBy: [{ email: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      select: { id: true, email: true },
    });

    return toLookupPage(rows, query.limit, (row) => ({
      id: row.id,
      label: row.email,
    }));
  }

  /**
   * Listings by their title, through `listings_title_trgm_idx` — regardless of case, since
   * a title is stored as its owner typed it. No btree orders by the title, and none is
   * worth one: the rows a search matches are sorted, not the table, and a filter box asks
   * for twenty of them.
   */
  private async findListings(
    scope: Prisma.ListingWhereInput,
    query: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    const rows = await this.prismaService.listing.findMany({
      where: {
        AND: [
          scope,
          ...lookupConditions(
            (title, id): Prisma.ListingWhereInput => ({ title, id }),
            { contains: escapeLike(query.q), mode: "insensitive" },
            query,
            cursor,
          ),
        ],
      },
      orderBy: [{ title: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      select: { id: true, title: true },
    });

    return toLookupPage(rows, query.limit, (row) => ({
      id: row.id,
      label: row.title,
    }));
  }
}
