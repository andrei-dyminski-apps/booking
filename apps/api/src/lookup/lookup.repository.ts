import { Injectable } from "@nestjs/common";
import type { LookupOption, LookupQuery } from "@repo/contracts";
import { againstListingsOf } from "../booking/infrastructure/booking.repository";
import type { Page } from "../common/paging";
import type { Prisma } from "../generated/prisma/client";
import { STILL_OFFERED } from "../listing/listing.repository";
import { escapeLike } from "../prisma/escape-like";
import { PrismaService } from "../prisma/prisma.service";
import type { LookupCursor } from "./lookup-cursor";
import { lookupConditions, toLookupPage } from "./lookup-page";

/**
 * Whether a lookup of accounts may match and show their addresses: an admin's may, a
 * host's may not. Two named values rather than a bare boolean, so a call site says which.
 */
const WITH_ADDRESS = "withAddress";
const NAME_ONLY = "nameOnly";

type Addresses = typeof WITH_ADDRESS | typeof NAME_ONLY;

/**
 * The queries behind the filter boxes: accounts by their name — and by their address, for
 * an admin — and listings by their title, each narrowed to the rows the list beside the box can actually show — a
 * suggestion that empties the list by construction is a box that lies.
 *
 * The rows leave as a `LookupOption`, a shape of this module's own: the id, the name a
 * person picks it by and the hint that tells two of one name apart. Both tables are read here rather than through the repository
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
      WITH_ADDRESS,
      query,
      cursor,
    );
  }

  /** Every account that ever took a stay — an admin's `?guestId=` reads them all. */
  findGuestsOfEveryone(
    query: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    return this.findAccounts(
      { bookings: { some: {} } },
      WITH_ADDRESS,
      query,
      cursor,
    );
  }

  /**
   * The accounts that took a stay against one of this owner's listings — by name alone:
   * the address of a guest is not the host's to read, so it is neither matched nor handed
   * back (see `lookupOptionSchema`).
   */
  findGuestsOfListingOwner(
    ownerId: string,
    query: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    return this.findAccounts(
      { bookings: { some: againstListingsOf(ownerId) } },
      NAME_ONLY,
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
   * Accounts by a part of their name, regardless of case — a name is stored as its owner
   * typed it — through `users_name_trgm_idx`, ordered by the name with the id behind it.
   * Where the caller may read addresses, a part of one matches too and is handed back as
   * the hint. That half is case-sensitive for the reason `userFilters` in
   * `user.repository.ts` gives — every stored address is lower-case, so the term is
   * lower-cased instead of the column — and `users_email_trgm_idx` serves it; Postgres
   * reads an `OR` of the two as a union of the two indexes.
   */
  private async findAccounts(
    scope: Prisma.UserWhereInput,
    addresses: Addresses,
    query: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    const byName: Prisma.UserWhereInput = {
      name: { contains: escapeLike(query.q), mode: "insensitive" },
    };
    const rows = await this.prismaService.user.findMany({
      where: {
        AND: [
          scope,
          ...lookupConditions(
            (name, id): Prisma.UserWhereInput => ({ name, id }),
            addresses === WITH_ADDRESS
              ? {
                  OR: [
                    byName,
                    { email: { contains: escapeLike(query.q.toLowerCase()) } },
                  ],
                }
              : byName,
            query,
            cursor,
          ),
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      select: { id: true, name: true, email: true },
    });

    return toLookupPage(rows, query.limit, (row) => ({
      id: row.id,
      label: row.name,
      hint: addresses === WITH_ADDRESS ? row.email : null,
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
            { title: { contains: escapeLike(query.q), mode: "insensitive" } },
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
      hint: null,
    }));
  }
}
