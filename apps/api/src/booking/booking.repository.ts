import { tz } from "@date-fns/tz";
import { Injectable } from "@nestjs/common";
import type { Booking, CreateBookingInput } from "@repo/contracts";
import { format } from "date-fns";
import { z } from "zod";
import {
  type Prisma,
  type Booking as BookingRow,
} from "../generated/prisma/client";
import { STILL_OFFERED } from "../listing/listing.repository";
import {
  isPrismaError,
  PrismaErrorCode,
  violatedConstraint,
} from "../prisma/prisma.errors";
import { PrismaService } from "../prisma/prisma.service";

/**
 * What `create` throws instead of letting a Prisma error code reach the service. Nothing
 * the API offers reaches it any more: `DELETE /listings/:id` retires a listing instead of
 * removing the row, so the key it points at stays satisfied. What is left is a hard
 * delete from outside — the seed, the cleanup of a test, whatever account deletion turns
 * out to be — and `test/booking.repository.e2e-spec.ts` provokes exactly that, because
 * which driver reports a foreign key violation, and under which code, is knowledge this
 * layer has to keep even when the branch is hard to reach through HTTP.
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
 * The owner of the listing is kept beside the booking rather than inside it: the
 * authorization rules need that column, the contract does not have it, and a flat shape
 * would let a `return booking` carry it into a response body without the types or the
 * review noticing.
 */
export type BookingWithListingOwner = {
  booking: Booking;
  listingOwnerId: string;
};

/**
 * Every query the module makes, and the whole of its knowledge about how a stay is stored:
 * that dates live in `@db.Date` columns while the contract speaks `YYYY-MM-DD`, and that
 * an overlap is a pair of strict inequalities. The service above keeps the rules and the
 * HTTP exceptions and sees neither Prisma nor a `Date`.
 *
 * Phase 4 gives this class the locking transaction the overlap check still lacks; it is
 * split out now because the translation of a driver failure has nowhere else to live.
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
   * The other query over `listings` from here, and the one that deliberately does not
   * narrow: the listing is resolved whether or not it has been retired, because the stay
   * is what its row was kept for and the owner who may read this booking is still its
   * owner.
   */
  async findByIdWithListingOwner(
    id: string,
  ): Promise<BookingWithListingOwner | null> {
    const row = await this.prismaService.booking.findUnique({
      where: { id },
      include: { listing: { select: { ownerId: true } } },
    });

    if (row === null) return null;

    return { booking: toBooking(row), listingOwnerId: row.listing.ownerId };
  }

  /**
   * A retired listing does not exist as far as a new stay is concerned, and this is the
   * only thing that says so: its row is still there, so the foreign key is satisfied and
   * the insert would go through. What "still offered" means is imported rather than
   * spelled again — `ListingRepository` owns that condition, and this is one of the two
   * queries over `listings` written outside it. Phase 4 is where the check stops being a
   * pre-flight and moves inside the transaction that locks the listing row.
   */
  async listingExists(listingId: string): Promise<boolean> {
    const listing = await this.prismaService.listing.findFirst({
      where: { id: listingId, ...STILL_OFFERED },
      select: { id: true },
    });

    return listing !== null;
  }

  /**
   * Strict inequalities on both sides, so a stay that starts on the day another ends is
   * not an overlap: the check-out date is the morning the room is free again.
   */
  async findOverlapping(input: CreateBookingInput): Promise<Booking | null> {
    const row = await this.prismaService.booking.findFirst({
      where: {
        listingId: input.listingId,
        from: { lt: new Date(input.to) },
        to: { gt: new Date(input.from) },
      },
    });

    return row === null ? null : toBooking(row);
  }

  async create(guestId: string, input: CreateBookingInput): Promise<Booking> {
    try {
      const row = await this.prismaService.booking.create({
        data: {
          listingId: input.listingId,
          guestId,
          from: new Date(input.from),
          to: new Date(input.to),
        },
      });

      return toBooking(row);
    } catch (error) {
      if (isPrismaError(error, PrismaErrorCode.ForeignKeyViolation)) {
        // Which of the two keys gave way decides the answer, and guessing is not an
        // option: the listing is the 404 the client can act on, the guest is a 401.
        switch (violatedForeignKey(error)) {
          case LISTING_FOREIGN_KEY:
            throw new ListingNotFoundError(input.listingId);
          case GUEST_FOREIGN_KEY:
            throw new GuestNotFoundError(guestId);
        }
      }

      throw error;
    }
  }

  /**
   * `false` is the row already being gone — cancelled by another request between the read
   * that authorized this one and the delete itself. `deleteMany` reports that in a count
   * instead of an exception, which is the whole reason it is used for a single row.
   */
  async delete(id: string): Promise<boolean> {
    const { count } = await this.prismaService.booking.deleteMany({
      where: { id },
    });

    return count > 0;
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
    createdAt: row.createdAt.toISOString(),
  };
}
