import { Injectable } from "@nestjs/common";
import type { Booking, CreateBookingInput } from "@repo/contracts";
import { Prisma, type Booking as BookingRow } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * What `create` throws instead of letting a Prisma error code reach the service. The
 * listing is checked before the insert, so this is only the race: it was deleted in
 * between, which the delete was allowed to do because nothing was booked against it yet.
 * Which driver reports a foreign key violation, and under which code, is exactly the
 * knowledge this layer exists to keep on its own side.
 */
export class ListingNotFoundError extends Error {
  constructor(listingId: string) {
    super(`Listing ${listingId} not found`);
    this.name = "ListingNotFoundError";
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

  async listingExists(listingId: string): Promise<boolean> {
    const listing = await this.prismaService.listing.findUnique({
      where: { id: listingId },
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
      ) {
        throw new ListingNotFoundError(input.listingId);
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

/** @db.Date columns arrive as a Date at UTC midnight, so slicing the ISO string is exact. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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
