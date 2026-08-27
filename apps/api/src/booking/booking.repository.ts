import { tz } from "@date-fns/tz";
import { Injectable } from "@nestjs/common";
import {
  BookingStatus,
  type Booking,
  type CreateBookingInput,
} from "@repo/contracts";
import { format } from "date-fns";
import { z } from "zod";
import {
  type Prisma,
  type Booking as BookingRow,
} from "../generated/prisma/client";
import {
  isExclusionViolation,
  isPrismaError,
  PrismaErrorCode,
  violatedConstraint,
} from "../prisma/prisma.errors";
import { PrismaService } from "../prisma/prisma.service";
import { ACTIVE_STATUSES, holdExpiry } from "./domain/booking-status";

/**
 * What `create` throws instead of letting a Prisma error code reach the service. The
 * listing key is now checked under the `FOR UPDATE` lock rather than at the insert, so an
 * insert only reaches this for the guest key — but the translation is kept whole, because
 * `test/booking.repository.e2e-spec.ts` still drives both sides directly.
 */
export class ListingNotFoundError extends Error {
  constructor(listingId: string) {
    super(`Listing ${listingId} not found`);
    this.name = "ListingNotFoundError";
  }
}

/**
 * The other row an insert can fail on, and the one nothing checks beforehand: the guest is
 * whoever the access token names, and `JwtStrategy` reads no database, so an account
 * deleted mid-session keeps minting valid requests for as long as `JWT_ACCESS_TTL`. That
 * is an ended session rather than a missing listing — the service answers it the way
 * `/auth/me` answers a token whose row is gone.
 */
export class GuestNotFoundError extends Error {
  constructor(guestId: string) {
    super(`Guest ${guestId} not found`);
    this.name = "GuestNotFoundError";
  }
}

/**
 * The dates asked for overlap an active stay on that listing. Raised from inside the
 * locking transaction — either by the explicit overlap check or, if a bug slips past it,
 * by the `EXCLUDE` constraint. The service turns both into one `409`.
 */
export class DatesUnavailableError extends Error {
  constructor(input: CreateBookingInput) {
    super(
      `Listing ${input.listingId} is already booked for an overlapping range (${input.from} to ${input.to})`,
    );
    this.name = "DatesUnavailableError";
  }
}

/**
 * The owner of the listing is kept beside the booking rather than inside it: the
 * authorization rules need that column, the contract does not have it, and a flat shape
 * would let a `return booking` carry it into a response body without the types or the
 * review noticing.
 */
export type BookingWithListingOwner = {
  booking: Booking;
  listingOwnerId: string;
};

/** One row of the `FOR UPDATE` read — raw SQL, so the column keeps its stored name. */
type LockedListing = { id: string; deleted_at: Date | null };

/**
 * Every query the module makes, and the whole of its knowledge about how a stay is stored:
 * that dates live in `@db.Date` columns while the contract speaks `YYYY-MM-DD`, that a
 * stay has a status and only two of the four hold the slot, and that an overlap is a pair
 * of strict inequalities.
 *
 * `create` is phase 4's centrepiece: an interactive transaction that locks the listing
 * row, so competing bookings for one listing are serialised instead of racing the
 * read-then-insert this module used to do.
 */
@Injectable()
export class BookingRepository {
  constructor(private readonly prismaService: PrismaService) {}

  findAll(): Promise<Booking[]> {
    return this.findWhere({});
  }

  findByGuest(guestId: string): Promise<Booking[]> {
    return this.findWhere({ guestId });
  }

  findByListingOwner(ownerId: string): Promise<Booking[]> {
    return this.findWhere({ listing: { ownerId } });
  }

  /**
   * Resolves the listing whether or not it has been retired, and the booking whatever its
   * status — the stay is what both rows were kept for. A cancelled or expired booking is
   * a record its guest is entitled to read, not a row that vanishes: `status` is on the
   * contract precisely so the answer can say which of the four it is, and the rules that
   * do care about "active" — the overlap check and what may still be cancelled — narrow
   * for themselves.
   */
  async findByIdWithListingOwner(
    id: string,
  ): Promise<BookingWithListingOwner | null> {
    const row = await this.prismaService.booking.findFirst({
      where: { id },
      include: { listing: { select: { ownerId: true } } },
    });

    if (row === null) return null;

    return { booking: toBooking(row), listingOwnerId: row.listing.ownerId };
  }

  /**
   * The three layers of phase 4, in one transaction:
   *
   *  1. `SELECT ... FOR UPDATE` on the listing row — two creates for the same listing
   *     serialise here instead of racing. `deleted_at` is read under the lock, the check
   *     the database stopped making when listings became soft-deletable.
   *  2. flip this listing's lapsed holds to `EXPIRED`, so a stale `PENDING_PAYMENT` row
   *     neither blocks the slot nor trips the `EXCLUDE` constraint on the insert below.
   *  3. refuse an overlap with an active stay — the informative `409`.
   *  4. insert the hold. The `EXCLUDE` constraint is the last line of defence if a bug
   *     ever reaches here, and it is answered as the same `409`.
   */
  async create(guestId: string, input: CreateBookingInput): Promise<Booking> {
    return this.prismaService.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<LockedListing[]>`
        SELECT id, deleted_at FROM listings WHERE id = ${input.listingId}::uuid FOR UPDATE
      `;

      if (locked[0] === undefined || locked[0].deleted_at !== null) {
        throw new ListingNotFoundError(input.listingId);
      }

      await tx.booking.updateMany({
        where: { listingId: input.listingId, ...lapsedHolds(new Date()) },
        data: { status: BookingStatus.EXPIRED },
      });

      const overlap = await tx.booking.findFirst({
        where: {
          listingId: input.listingId,
          status: { in: [...ACTIVE_STATUSES] },
          from: { lt: new Date(input.to) },
          to: { gt: new Date(input.from) },
        },
        select: { id: true },
      });

      if (overlap !== null) {
        throw new DatesUnavailableError(input);
      }

      try {
        const row = await tx.booking.create({
          data: {
            listingId: input.listingId,
            guestId,
            from: new Date(input.from),
            to: new Date(input.to),
            status: BookingStatus.PENDING_PAYMENT,
            expiresAt: holdExpiry(new Date()),
          },
        });

        return toBooking(row);
      } catch (error) {
        if (isExclusionViolation(error)) {
          throw new DatesUnavailableError(input);
        }

        if (isPrismaError(error, PrismaErrorCode.ForeignKeyViolation)) {
          // The listing key is unreachable from here — the `FOR UPDATE` read already
          // refused a missing row. What is left is the guest, which nothing checks first.
          switch (violatedForeignKey(error)) {
            case LISTING_FOREIGN_KEY:
              throw new ListingNotFoundError(input.listingId);
            case GUEST_FOREIGN_KEY:
              throw new GuestNotFoundError(guestId);
          }
        }

        throw error;
      }
    });
  }

  /**
   * Cancelling keeps the row and moves it out of the active set: the record is what phase
   * 5 refunds against, and an inactive status frees the slot the `EXCLUDE` constraint
   * guards. `expiresAt` is left where it is — the deadline this hold had is part of that
   * record, and `status` is what says it no longer holds anything. `false` is the row
   * already being gone from the active set — cancelled or expired by another request
   * between the read that authorized this one and here. `updateMany` reports that in a
   * count instead of an exception, the same trade the old `delete` made with `deleteMany`.
   */
  async cancel(id: string): Promise<boolean> {
    const { count } = await this.prismaService.booking.updateMany({
      where: { id, status: { in: [...ACTIVE_STATUSES] } },
      data: { status: BookingStatus.CANCELLED },
    });

    return count > 0;
  }

  /**
   * What the job scheduled for one hold's deadline does. Idempotent and safe to run late —
   * a hold already confirmed, cancelled or expired matches the `where` on nothing, and the
   * job is a no-op.
   */
  async expireHold(id: string): Promise<void> {
    await this.prismaService.booking.updateMany({
      where: { id, ...lapsedHolds(new Date()) },
      data: { status: BookingStatus.EXPIRED },
    });
  }

  /**
   * The same thing asked of every listing at once, and what the repeatable sweep runs.
   * It exists because the per-hold jobs live in Redis and the lazy check inside `create`
   * only ever looks at the listing being booked: without it, a hold whose job was lost on
   * a listing nobody books again would hold its slot forever. The count is what the
   * processor logs.
   */
  async expireLapsedHolds(): Promise<number> {
    const { count } = await this.prismaService.booking.updateMany({
      where: lapsedHolds(new Date()),
      data: { status: BookingStatus.EXPIRED },
    });

    return count;
  }

  private async findWhere(where: Prisma.BookingWhereInput): Promise<Booking[]> {
    const rows = await this.prismaService.booking.findMany({
      where,
      orderBy: { from: "asc" },
    });

    return rows.map(toBooking);
  }
}

/**
 * A hold whose deadline has passed, written once because three writes ask for it: the
 * lazy sweep inside `create`, the job that releases one hold and the repeatable sweep
 * behind it. The boundary is inclusive: a hold is done holding the moment its deadline is
 * reached, not a millisecond after.
 */
function lapsedHolds(now: Date): Prisma.BookingWhereInput {
  return { status: BookingStatus.PENDING_PAYMENT, expiresAt: { lte: now } };
}

/**
 * The names Postgres gives the two foreign keys of `bookings`; they are written down in
 * `migration.sql` under `prisma/migrations`, which is what makes them a fact of the
 * schema rather than a guess about Prisma's naming.
 */
const LISTING_FOREIGN_KEY = "bookings_listing_id_fkey";
const GUEST_FOREIGN_KEY = "bookings_guest_id_fkey";

/**
 * A foreign key violation names the key by index rather than by column, unlike the unique
 * conflict in `user.repository.ts`; the path to the constraint is the shared one.
 */
const foreignKeyConstraintSchema = z.object({ index: z.string() });

/**
 * `null` for a constraint this cannot read, and the caller then rethrows the Prisma error
 * as a 500. That is deliberate, and the opposite of what `conflictsOnEmail` decides: with
 * two candidate keys a fallback would have to pick one, and both wrong answers are worse
 * than an honest failure — a 404 about a listing that is there, or a 401 that ends a
 * session which never expired.
 */
function violatedForeignKey(
  error: Prisma.PrismaClientKnownRequestError,
): string | null {
  return violatedConstraint(error, foreignKeyConstraintSchema)?.index ?? null;
}

/** @db.Date columns arrive as a Date at UTC midnight, so formatting in UTC is exact. */
function toIsoDate(date: Date): string {
  return format(date, "yyyy-MM-dd", { in: tz("UTC") });
}

function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    listingId: row.listingId,
    guestId: row.guestId,
    from: toIsoDate(row.from),
    to: toIsoDate(row.to),
    status: row.status,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
