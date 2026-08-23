import { Injectable } from "@nestjs/common";
import type {
  CreateListingInput,
  Listing,
  UpdateListingInput,
} from "@repo/contracts";
import {
  type Prisma,
  type Listing as ListingRow,
} from "../generated/prisma/client";
import { isPrismaError, PrismaErrorCode } from "../prisma/prisma.errors";
import { PrismaService } from "../prisma/prisma.service";

/**
 * What `delete` throws instead of letting a Prisma error code reach the service. The
 * bookings are counted before the delete, so this is only the race the count cannot
 * close: a stay taken against the listing since it was counted. Which driver reports a
 * foreign key violation, and under which code, is exactly the knowledge this layer exists
 * to keep on its own side.
 */
export class ListingHasBookingsError extends Error {
  constructor(listingId: string) {
    super(`Listing ${listingId} has bookings and cannot be deleted`);
    this.name = "ListingHasBookingsError";
  }
}

/**
 * Every query the module makes, and the whole of its knowledge about how a listing is
 * stored: the row shape, its projection onto the contract, and the two codes a
 * read-then-write can lose its race to. The service above keeps the rules and the HTTP
 * exceptions and sees neither Prisma nor a row.
 *
 * The booking count lives here rather than in `BookingRepository`: it answers a question
 * about a listing — whether this one may still be deleted — and phase 4 moves it inside
 * the transaction that locks the listing row, which is a transaction of this module.
 */
@Injectable()
export class ListingRepository {
  constructor(private readonly prismaService: PrismaService) {}

  findAll(): Promise<Listing[]> {
    return this.findWhere({});
  }

  findByOwner(ownerId: string): Promise<Listing[]> {
    return this.findWhere({ ownerId });
  }

  async findById(id: string): Promise<Listing | null> {
    const row = await this.prismaService.listing.findUnique({ where: { id } });

    return row === null ? null : toListing(row);
  }

  async create(ownerId: string, input: CreateListingInput): Promise<Listing> {
    const row = await this.prismaService.listing.create({
      data: { ...input, ownerId },
    });

    return toListing(row);
  }

  /**
   * `null` is the row already being gone — deleted by its owner or an admin between the
   * read that authorized this update and the update itself.
   */
  async update(id: string, input: UpdateListingInput): Promise<Listing | null> {
    try {
      const row = await this.prismaService.listing.update({
        where: { id },
        data: input,
      });

      return toListing(row);
    } catch (error) {
      if (isPrismaError(error, PrismaErrorCode.RecordNotFound)) return null;

      throw error;
    }
  }

  countBookings(listingId: string): Promise<number> {
    return this.prismaService.booking.count({ where: { listingId } });
  }

  /** `false` is the same race as in `update`: another request deleted the row first. */
  async delete(id: string): Promise<boolean> {
    try {
      await this.prismaService.listing.delete({ where: { id } });

      return true;
    } catch (error) {
      if (isPrismaError(error, PrismaErrorCode.ForeignKeyViolation)) {
        throw new ListingHasBookingsError(id);
      }

      if (isPrismaError(error, PrismaErrorCode.RecordNotFound)) return false;

      throw error;
    }
  }

  private async findWhere(where: Prisma.ListingWhereInput): Promise<Listing[]> {
    const rows = await this.prismaService.listing.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return rows.map(toListing);
  }
}

function toListing(row: ListingRow): Listing {
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    description: row.description,
    pricePerNight: row.pricePerNight,
    capacity: row.capacity,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
