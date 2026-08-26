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
 * Two queries over `listings` are written outside this file, both in `BookingRepository`,
 * and each says which of the two it is: `listingExists` narrows through the same exported
 * constant rather than a second copy of `deletedAt: null`, and `findByIdWithListingOwner`
 * deliberately does not narrow at all, because it resolves the listing of a stay whether
 * or not it is retired and the stay is what the row was kept for. Phase 4's locking
 * transaction will be the third, and it has to answer the same question.
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

  /** `null` for a retired row as well: to everyone reading it, that listing is gone. */
  async findById(id: string): Promise<Listing | null> {
    const row = await this.prismaService.listing.findFirst({
      where: { id, ...STILL_OFFERED },
    });

    return row === null ? null : toListing(row);
  }

  async create(ownerId: string, input: CreateListingInput): Promise<Listing> {
    const row = await this.prismaService.listing.create({
      data: { ...input, ownerId },
    });

    return toListing(row);
  }

  /**
   * `null` is the row already being gone — retired by its owner or an admin between the
   * read that authorized this update and the update itself. Retired is gone here too:
   * editing a listing nobody is offered is a write the owner has no way to see the result
   * of.
   */
  async update(id: string, input: UpdateListingInput): Promise<Listing | null> {
    try {
      const row = await this.prismaService.listing.update({
        where: { id, ...STILL_OFFERED },
        data: input,
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

  private async findWhere(where: Prisma.ListingWhereInput): Promise<Listing[]> {
    const rows = await this.prismaService.listing.findMany({
      where: { ...where, ...STILL_OFFERED },
      orderBy: { createdAt: "desc" },
    });

    return rows.map(toListing);
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
