import { Injectable } from "@nestjs/common";
import {
  ReviewKind,
  type CreateReviewInput,
  type Review,
  type ReviewQuery,
  type ReviewSummary,
} from "@repo/contracts";
import {
  type Prisma,
  type Review as ReviewRow,
} from "../generated/prisma/client";
import { afterCreatedAt, CREATED_AT_ORDER, type Page } from "../common/paging";
import { isPrismaError, PrismaErrorCode } from "../prisma/prisma.errors";
import { PrismaService } from "../prisma/prisma.service";
import type { ReviewCursor } from "./review-cursor";

/**
 * The stay already has a review of this kind. Raised from the unique `(booking_id, kind)`
 * pair rather than checked beforehand: two submits of the same form race, and only the
 * constraint can settle which of them was first.
 */
export class ReviewAlreadyWrittenError extends Error {
  constructor(bookingId: string, kind: ReviewKind) {
    super(`Booking ${bookingId} already has a ${kind} review`);
    this.name = "ReviewAlreadyWrittenError";
  }
}

/**
 * Every query over `reviews`. Both lists are reached through the booking a review was
 * written against — the reviews of a listing are the `LISTING` reviews of its stays, the
 * reviews of a guest the `GUEST` reviews of theirs — which is why the table carries neither
 * id itself; see the note on the model.
 *
 * Who may read which list is not decided here: the service picks the list and this answers
 * it, the same split `BookingRepository` has with the scopes of `GET /bookings`.
 */
@Injectable()
export class ReviewRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /** What guests said about this listing — public, so retired or not is the service's question. */
  findPageForListing(
    listingId: string,
    query: ReviewQuery,
    cursor: ReviewCursor | null,
  ): Promise<Page<Review>> {
    return this.findPage(aboutListing(listingId), query, cursor);
  }

  /** What hosts said about this guest. */
  findPageForGuest(
    guestId: string,
    query: ReviewQuery,
    cursor: ReviewCursor | null,
  ): Promise<Page<Review>> {
    return this.findPage(aboutGuest(guestId), query, cursor);
  }

  summaryForListing(listingId: string): Promise<ReviewSummary> {
    return this.summaryOf(aboutListing(listingId));
  }

  summaryForGuest(guestId: string): Promise<ReviewSummary> {
    return this.summaryOf(aboutGuest(guestId));
  }

  async create(
    bookingId: string,
    kind: ReviewKind,
    input: CreateReviewInput,
  ): Promise<Review> {
    try {
      const row = await this.prismaService.review.create({
        data: { bookingId, kind, ...input },
      });

      return toReview(row);
    } catch (error) {
      // `(booking_id, kind)` is the only unique key of the table besides the primary one,
      // which the database generates — so a conflict needs no reading of which key it was.
      if (isPrismaError(error, PrismaErrorCode.UniqueViolation)) {
        throw new ReviewAlreadyWrittenError(bookingId, kind);
      }

      throw error;
    }
  }

  /** The moderation of an admin. `false` is a review another admin removed first. */
  async delete(id: string): Promise<boolean> {
    const { count } = await this.prismaService.review.deleteMany({
      where: { id },
    });

    return count > 0;
  }

  /**
   * One page, `limit + 1` rows so the caller learns whether there is another without a
   * `count` — and the scope and the cursor under one `AND`, for the reason
   * `BookingRepository.findPage` gives.
   */
  private async findPage(
    scope: Prisma.ReviewWhereInput,
    query: ReviewQuery,
    cursor: ReviewCursor | null,
  ): Promise<Page<Review>> {
    const rows = await this.prismaService.review.findMany({
      where: {
        AND: [scope, ...(cursor === null ? [] : [afterCreatedAt(cursor)])],
      },
      orderBy: CREATED_AT_ORDER[query.sort],
      take: query.limit + 1,
    });

    return {
      items: rows.slice(0, query.limit).map(toReview),
      hasMore: rows.length > query.limit,
    };
  }

  /**
   * The mean is rounded to one decimal here, where the number is made, rather than on the
   * screen: four-point-something-recurring is not a rating anybody gives, and a frontend
   * that rounded it would be one more place to decide how.
   */
  private async summaryOf(
    scope: Prisma.ReviewWhereInput,
  ): Promise<ReviewSummary> {
    const { _count, _avg } = await this.prismaService.review.aggregate({
      where: scope,
      _count: { _all: true },
      _avg: { rating: true },
    });

    return {
      count: _count._all,
      average: _avg.rating === null ? null : Math.round(_avg.rating * 10) / 10,
    };
  }
}

function aboutListing(listingId: string): Prisma.ReviewWhereInput {
  return { kind: ReviewKind.LISTING, booking: { listingId } };
}

function aboutGuest(guestId: string): Prisma.ReviewWhereInput {
  return { kind: ReviewKind.GUEST, booking: { guestId } };
}

function toReview(row: ReviewRow): Review {
  return {
    id: row.id,
    kind: row.kind,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
  };
}
