import { Injectable } from "@nestjs/common";
import { weekdaySchema, type Weekday } from "@repo/contracts";
import type {
  CreateListingInput,
  Listing,
  ListingDetail,
  ListingPricing,
  ListingQuery,
  ListingSort,
  UpdateListingInput,
} from "@repo/contracts";
import {
  holdsTheSlot,
  overlapping,
} from "../booking/infrastructure/booking.repository";
import {
  type Prisma,
  type Listing as ListingRow,
} from "../generated/prisma/client";
import { afterCreatedAt, CREATED_AT_ORDER, type Page } from "../common/paging";
import { startOfToday } from "../common/iso-date";
import { isPrismaError, PrismaErrorCode } from "../prisma/prisma.errors";
import { PrismaService } from "../prisma/prisma.service";
import { toPricing } from "./listing-pricing";
import type { CatalogueCursor } from "./catalogue-cursor";

/**
 * Every query the module makes, and the whole of its knowledge about how a listing is
 * stored: the row shape, its projection onto the contract, and the code a read-then-write
 * can lose its race to. The service above keeps the rules and the HTTP exceptions and
 * sees neither Prisma nor a row.
 *
 * It is also where the application keeps its knowledge that a retired listing is a row
 * rather than an absence. The condition is `STILL_OFFERED` below, every read of this
 * class is already narrowed by it, and a caller cannot forget a filter it has no way to
 * spell. That is what makes the soft delete affordable — the rule is written once.
 *
 * Three queries over `listings` are written outside this file, and each says whether it
 * narrows. `BookingRepository.findByIdWithListingOwner` deliberately does not, because it
 * resolves the listing of a stay whether or not it is retired and the stay is what the
 * row was kept for; `LookupRepository.findListings` does not either, for the same reason.
 * The `FOR UPDATE` read inside `BookingRepository.create` checks `deleted_at` itself —
 * the one place the check has to be atomic.
 *
 * The traffic goes the other way here: the catalogue's date filter asks which listings
 * have no stay holding the slot, and it imports that condition from `BookingRepository`
 * rather than restating it. A `where` is what may cross between two repositories; a row
 * mapping is not, which is why the availability of one listing is read over there and
 * only injected into `ListingService`.
 */
@Injectable()
export class ListingRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * One page of the catalogue: the filters as a `where`, the keyset cursor as one more
   * condition on the same `where`, and `limit + 1` rows so the caller learns whether there
   * is a page after this one without a second `count` over the whole table.
   *
   * The ordering is the client's now, and it is still not a preference: each of the four
   * is an index the migrations create (partial on `deleted_at IS NULL`, which every read
   * of this class already narrows by) and a pair the cursor carries. `ORDER_BY`,
   * `afterCursor` and those indexes are one decision — changing one of the three means
   * changing all three.
   *
   * The cursor is the one this sort issued: the service refuses one handed back under
   * another, so `afterCursor` never has to compare a price against a timestamp.
   */
  async findPage(
    query: ListingQuery,
    cursor: CatalogueCursor | null,
  ): Promise<Page<Listing>> {
    const rows = await this.prismaService.listing.findMany({
      where: catalogueWhere(query, cursor),
      orderBy: ORDER_BY[query.sort],
      take: query.limit + 1,
    });

    return {
      items: rows.slice(0, query.limit).map(toListing),
      hasMore: rows.length > query.limit,
    };
  }

  /** The owner's dashboard — every listing of theirs, unpaged and unfiltered. */
  async findByOwner(ownerId: string): Promise<Listing[]> {
    const rows = await this.prismaService.listing.findMany({
      where: { ownerId, ...STILL_OFFERED },
      orderBy: { createdAt: "desc" },
    });

    return rows.map(toListing);
  }

  /** `null` for a retired row as well: to everyone reading it, that listing is gone. */
  async findById(id: string): Promise<Listing | null> {
    const row = await this.prismaService.listing.findFirst({
      where: { id, ...STILL_OFFERED },
    });

    return row === null ? null : toListing(row);
  }

  /**
   * The row with the exceptions to its price — what the listing's own page reads. Only the
   * date prices from today (UTC) on: a past night is never booked again, and the contract
   * caps how many dates a listing may price, so the ones that have passed should not count
   * against a list the owner sees and edits.
   */
  async findDetailById(id: string): Promise<ListingDetail | null> {
    const row = await this.prismaService.listing.findFirst({
      where: { id, ...STILL_OFFERED },
      include: {
        weekdayPrices: true,
        datePrices: {
          where: { date: { gte: startOfToday(new Date()) } },
          orderBy: { date: "asc" },
        },
      },
    });

    return row === null
      ? null
      : {
          ...toListing(row),
          pricing: toPricing(row.weekdayPrices, row.datePrices),
        };
  }

  /** One statement, nested writes included, so a listing never exists without its prices. */
  async create(ownerId: string, input: CreateListingInput): Promise<Listing> {
    const { pricing, ...fields } = input;

    const row = await this.prismaService.listing.create({
      data: {
        ...fields,
        ownerId,
        ...(pricing === undefined ? {} : pricingRows(pricing)),
      },
    });

    return toListing(row);
  }

  /**
   * `null` is the row already being gone — retired by its owner or an admin between the
   * read that authorized this update and the update itself. Retired is gone here too:
   * editing a listing nobody is offered is a write the owner has no way to see the result
   * of.
   *
   * Prices present in the input replace the whole set, past dates included. The listing
   * row is written first and inside the same transaction, and that order is the point: the
   * `UPDATE` locks the row, so two saves of the same listing's prices run one after the
   * other instead of both clearing the set and then colliding on the key as each inserts
   * its own. With prices in the input `updatedAt` is stamped explicitly, and both halves
   * hang on that stamp: given nested writes alone, Prisma issues no `UPDATE` of the row at
   * all — `@updatedAt` is left as it was and nothing is locked. Without prices there is
   * nothing to lock for, and `@updatedAt` stamps the row on its own.
   */
  async update(id: string, input: UpdateListingInput): Promise<Listing | null> {
    const { pricing, ...fields } = input;

    try {
      const row = await this.prismaService.listing.update({
        where: { id, ...STILL_OFFERED },
        data: {
          ...fields,
          ...(pricing === undefined
            ? {}
            : { updatedAt: new Date(), ...pricingRows(pricing, true) }),
        },
      });

      return toListing(row);
    } catch (error) {
      if (isPrismaError(error, PrismaErrorCode.RecordNotFound)) return null;

      throw error;
    }
  }

  /**
   * Stamps the row instead of removing it, so the bookings pointing at it keep naming
   * where the stay was. `false` is the same race as in `update`: another request retired
   * the listing first. `updateMany` reports that in a count rather than an exception,
   * which is the whole reason it is used for a single row — the same trade
   * `BookingRepository.delete` makes with `deleteMany`.
   */
  async softDelete(id: string): Promise<boolean> {
    const { count } = await this.prismaService.listing.updateMany({
      where: { id, ...STILL_OFFERED },
      data: { deletedAt: new Date() },
    });

    return count > 0;
  }
}

/**
 * The one condition every read of a listing shares. Spelled once so that a new query
 * cannot be written without it and a reader can see that none of them was; exported
 * because `BookingRepository` reads this table too — see the note on the class.
 */
export const STILL_OFFERED = {
  deletedAt: null,
} satisfies Prisma.ListingWhereInput;

/**
 * The catalogue's filters, the availability one included. `undefined` is how Prisma spells
 * "no condition", so an absent filter needs no branch of its own — what does need one is
 * the date window, because it is a relation subquery rather than a comparison, and the
 * cursor, whose two comparisons are one condition.
 *
 * The dates read as: no stay against this listing both holds its slot and overlaps the
 * window. The two halves come from `BookingRepository`, so the catalogue and the check
 * that refuses a booking cannot disagree about what "taken" means.
 *
 * The cursor goes under `AND` rather than into this object, and that is not a matter of
 * shape: it narrows by the sort key, which for a price-ordered page is the same field
 * `minPrice`/`maxPrice` narrow. Spread in here, the later key would replace the earlier
 * one and every page after the first would silently drop the price filter.
 */
function catalogueWhere(
  query: ListingQuery,
  cursor: CatalogueCursor | null,
): Prisma.ListingWhereInput {
  const { from, to } = query;

  return {
    ...STILL_OFFERED,
    ownerId: query.ownerId,
    capacity: { gte: query.guests },
    pricePerNight: { gte: query.minPrice, lte: query.maxPrice },
    ...(from !== undefined && to !== undefined
      ? {
          bookings: {
            none: { ...holdsTheSlot(new Date()), ...overlapping(from, to) },
          },
        }
      : {}),
    ...(cursor === null ? {} : { AND: afterCursor(cursor) }),
  };
}

/**
 * What the catalogue is ordered by, one entry per value the contract offers.
 *
 * The tiebreaker follows the direction of the key rather than being fixed, and that is an
 * index decision rather than a matter of taste: `price ASC, id ASC` and `price DESC, id
 * DESC` are exact reverses of each other, so one btree read forwards and backwards answers
 * both — Postgres cannot read a single index backwards when the two columns disagree about
 * direction. The same is true of the pair above it, which is why `oldest` needs no index
 * of its own beside `newest`.
 */
const ORDER_BY: Record<ListingSort, Prisma.ListingOrderByWithRelationInput[]> =
  {
    ...CREATED_AT_ORDER,
    priceAsc: [{ pricePerNight: "asc" }, { id: "asc" }],
    priceDesc: [{ pricePerNight: "desc" }, { id: "desc" }],
  };

/**
 * Everything that sorts after the cursor row under the ordering it was issued in: past the
 * key, or level with it and past the id. It is written as a comparison against the values
 * the cursor carries rather than through Prisma's own `cursor` option, because that one
 * resolves the row by id first — so a listing retired between two pages would match
 * nothing and end the catalogue early.
 *
 * **The inclusive bound on the key is what makes the index a seek rather than a scan**,
 * and it is the reason each branch says the key twice. `key > X OR (key = X AND id > Y)`
 * is the whole truth about where the page starts, but Postgres cannot read a start
 * position out of an `OR`: it takes the index for the `ORDER BY`, walks it from the top and
 * throws away everything before the cursor with a filter — a page deep in the catalogue
 * then costs what an offset would, which is the one thing a keyset page exists not to do.
 * `key >= X` beside it is redundant as a condition and decisive as an index condition, and
 * the `OR` stays to settle the rows level with the cursor. A row comparison —
 * `(key, id) > (X, Y)` — would say both at once and is what the index wants, but Prisma
 * cannot spell one.
 *
 * The bound is why the result is `AND`-ed rather than spread into `catalogueWhere`; see
 * the note there.
 *
 * The switch is exhaustive, which is what keeps it in step with `ORDER_BY` above: a fifth
 * sort in the contract stops compiling in both places, and in `catalogue-cursor.ts` with
 * them.
 */
function afterCursor(cursor: CatalogueCursor): Prisma.ListingWhereInput {
  switch (cursor.sort) {
    case "newest":
    case "oldest":
      return afterCreatedAt(cursor);
    case "priceAsc":
      return {
        pricePerNight: { gte: cursor.pricePerNight },
        OR: [
          { pricePerNight: { gt: cursor.pricePerNight } },
          { pricePerNight: cursor.pricePerNight, id: { gt: cursor.id } },
        ],
      };
    case "priceDesc":
      return {
        pricePerNight: { lte: cursor.pricePerNight },
        OR: [
          { pricePerNight: { lt: cursor.pricePerNight } },
          { pricePerNight: cursor.pricePerNight, id: { lt: cursor.id } },
        ],
      };
  }
}

/**
 * `price_per_night` is a `numeric` column, which the driver hands over as a `Decimal`
 * rather than as a number — exactly so that reading it cannot lose a cent on the way. The
 * contract speaks a `number`, and this is the one place that conversion happens: the scale
 * is two decimals and a double holds that exactly up to far more than the ceiling a price
 * has, so nothing is lost by it either.
 */
function toListing(row: ListingRow): Listing {
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    description: row.description,
    pricePerNight: row.pricePerNight.toNumber(),
    capacity: row.capacity,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The prices as nested writes of the listing. `replace` clears the old set first — inside
 * the same statement, so the listing is never seen with half a set — which is what makes a
 * `PATCH` carrying prices the whole of them rather than a merge.
 */
function pricingRows(
  pricing: ListingPricing,
  replace = false,
): Pick<Prisma.ListingUpdateInput, "weekdayPrices" | "datePrices"> &
  Pick<Prisma.ListingCreateInput, "weekdayPrices" | "datePrices"> {
  const weekdays = Object.entries(pricing.weekdays).flatMap(
    ([weekday, price]) =>
      price === undefined ? [] : [{ weekday: weekdayOf(weekday), price }],
  );
  const dates = pricing.dates.map(({ date, price }) => ({
    // A `YYYY-MM-DD` parses as UTC midnight, which is what a `@db.Date` holds.
    date: new Date(date),
    price,
  }));

  return {
    weekdayPrices: {
      ...(replace ? { deleteMany: {} } : {}),
      create: weekdays,
    },
    datePrices: {
      ...(replace ? { deleteMany: {} } : {}),
      create: dates,
    },
  };
}

/**
 * `Object.entries` widens the keys of `weekdays` back to `string`; the parse narrows one
 * again without a cast, and the input was validated against the same enum before it got
 * here, so the throw is unreachable from a request.
 */
function weekdayOf(key: string): Weekday {
  const parsed = weekdaySchema.safeParse(key);

  if (!parsed.success) throw new Error(`${key} is not a day of the week`);

  return parsed.data;
}
