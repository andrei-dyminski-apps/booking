import { Injectable } from "@nestjs/common";
import type { LookupOption, LookupQuery } from "@repo/contracts";
import { againstListingsOf } from "../booking/infrastructure/booking-where";
import type { Page } from "../common/paging";
import { Prisma } from "../generated/prisma/client";
import { escapeLike } from "../prisma/escape-like";
import { PrismaService } from "../prisma/prisma.service";
import type { LookupCursor } from "./lookup-cursor";
import { idIn, lookupConditions, toLookupPage } from "./lookup-page";

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
 * `ListingRepository` is narrowed to what is still on offer. `againstListingsOf` keeps
 * the owner's lookups aligned with their stays.
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
      Prisma.sql`EXISTS (
        SELECT 1 FROM listings WHERE owner_id = u.id AND deleted_at IS NULL
      )`,
      query,
      cursor,
    );
  }

  /**
   * Every account a stay was ever taken against, its listing retired or not — what an
   * admin's `?hostId=` over stays can match, where `findOwners` would miss a host whose
   * listings are all gone while their stays still wait on money.
   */
  findHostsOfEveryone(
    query: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    return this.findAccounts(
      Prisma.sql`EXISTS (
        SELECT 1 FROM listings AS l JOIN bookings AS b ON b.listing_id = l.id
        WHERE l.owner_id = u.id
      )`,
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
      Prisma.sql`EXISTS (SELECT 1 FROM bookings WHERE guest_id = u.id)`,
      query,
      cursor,
    );
  }

  /**
   * The accounts that took a stay against one of this owner's listings — by name alone:
   * the address of a guest is not the host's to read, so it is neither matched nor handed
   * back (see `lookupOptionSchema`).
   */
  async findGuestsOfListingOwner(
    ownerId: string,
    query: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    const rows = await this.prismaService.user.findMany({
      where: {
        AND: [
          { bookings: { some: againstListingsOf(ownerId) } },
          ...lookupConditions(
            (name, id): Prisma.UserWhereInput => ({ name, id }),
            { name: { contains: escapeLike(query.q), mode: "insensitive" } },
            query,
            cursor,
          ),
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      select: { id: true, name: true },
    });
    return toLookupPage(rows, query.limit, (row) => ({
      id: row.id,
      label: row.name,
      hint: null,
    }));
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
   * Admins can match names and addresses through the two text trigram indexes.
   */
  private async findAccounts(
    scope: Prisma.Sql,
    query: LookupQuery,
    cursor: LookupCursor | null,
  ): Promise<Page<LookupOption>> {
    const id = idIn(query.q);
    const pattern = `%${escapeLike(query.q)}%`;
    const matches = id
      ? Prisma.sql`u.id = ${id}::uuid`
      : Prisma.sql`(u.name ILIKE ${pattern} OR u.email::text ILIKE ${pattern})`;
    const after = cursor
      ? Prisma.sql`AND (u.name, u.id) > (${cursor.label}, ${cursor.id}::uuid)`
      : Prisma.empty;
    const rows = await this.prismaService.$queryRaw<
      { id: string; name: string; email: string }[]
    >`
      SELECT u.id, u.name, u.email::text AS email FROM users AS u
      WHERE ${scope} AND ${matches} ${after}
      ORDER BY u.name, u.id
      LIMIT ${query.limit + 1}
    `;

    return toLookupPage(rows, query.limit, (row) => ({
      id: row.id,
      label: row.name,
      hint: row.email,
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
