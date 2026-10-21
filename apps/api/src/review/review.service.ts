import { TZDate } from "@date-fns/tz";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  isReviewable,
  NotificationType,
  ReviewKind,
  Role,
  type CreateReviewInput,
  type Review,
  type ReviewPage,
  type ReviewQuery,
} from "@repo/contracts";
import { format } from "date-fns";
import type { AuthenticatedUser } from "../auth/auth.types";
import {
  BookingRepository,
  type BookingWithListingOwner,
} from "../booking/booking.repository";
import { readCursor, type Page } from "../common/paging";
import { ListingRepository } from "../listing/listing.repository";
import { NotificationService } from "../notification/notification.service";
import { decodeCursor, encodeCursor, type ReviewCursor } from "./review-cursor";
import {
  ReviewAlreadyWrittenError,
  ReviewRepository,
} from "./review.repository";

/**
 * The rules of the two-sided review: who may write which half of a stay, when, and who may
 * read what was written. The queries are `ReviewRepository`'s; the stay a review is about
 * is read through `BookingRepository`, which already resolves the listing's owner beside
 * it for the authorization rules of the bookings.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly bookingRepository: BookingRepository,
    private readonly listingRepository: ListingRepository,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * The guests' reviews of one listing, for everybody. A retired listing answers `404`
   * like `GET /listings/:id` does — this read is public and cached by URL beside that one,
   * and the two disagreeing about whether the listing exists would be a page with reviews
   * of nothing.
   */
  async findListingPage(
    listingId: string,
    query: ReviewQuery,
  ): Promise<ReviewPage> {
    if ((await this.listingRepository.findById(listingId)) === null) {
      throw new NotFoundException(`Listing ${listingId} not found`);
    }

    const cursor = this.cursorOf(ReviewKind.LISTING, query);
    const [page, summary] = await Promise.all([
      this.reviewRepository.findPageForListing(listingId, query, cursor),
      this.reviewRepository.summaryForListing(listingId),
    ]);

    return { ...this.withCursor(page, query), summary };
  }

  /**
   * The hosts' reviews of one guest. Not public: what a host thinks of a guest is the
   * business of the guest it is about, of the hosts that guest asks to stay with, and of
   * an admin — not of the site. Anybody else is answered `404` rather than `403`, for the
   * reason `BookingService.getReadable` gives: nothing lists guests to a stranger, so a
   * `403` would be the one way to learn that an id is somebody's account.
   *
   * An id that names nobody is an empty list to the two callers allowed to ask about
   * anybody (an admin) or about themselves — truthfully: there are no reviews of it.
   */
  async findGuestPage(
    guestId: string,
    user: AuthenticatedUser,
    query: ReviewQuery,
  ): Promise<ReviewPage> {
    if (!(await this.mayReadGuest(guestId, user))) {
      throw new NotFoundException(`Guest ${guestId} not found`);
    }

    const cursor = this.cursorOf(ReviewKind.GUEST, query);
    const [page, summary] = await Promise.all([
      this.reviewRepository.findPageForGuest(guestId, query, cursor),
      this.reviewRepository.summaryForGuest(guestId),
    ]);

    return { ...this.withCursor(page, query), summary };
  }

  /**
   * Writing one half of a stay. Which half follows from who is writing — the guest reviews
   * the listing, the host reviews the guest — so the request carries no kind, and there is
   * nothing a caller can send to write the other side's half.
   *
   * Three refusals, in the order a caller could have known about them. A stay the caller
   * is not one of the two sides of is `404`, the same answer `GET /bookings/:id` gives it.
   * A stay that is not over, or never happened, is `409`: the caller can see the booking
   * and its status, and the answer is about its state rather than about them. A half that
   * is already written is `409` too, decided by the unique key rather than by a read first,
   * because two submits of one form race.
   *
   * A stay at a listing that has since been retired is still reviewable, and on purpose:
   * the stay happened, and the host's half about the guest is as true as ever. The
   * guest's half is written too, but nobody reads it while the listing is retired —
   * `findListingPage` answers `404` for the listing — so it waits rather than being
   * refused, and the summary counts it the day the listing is offered again.
   */
  async create(
    bookingId: string,
    user: AuthenticatedUser,
    input: CreateReviewInput,
  ): Promise<Review> {
    const found =
      await this.bookingRepository.findByIdWithListingOwner(bookingId);
    const kind = found === null ? null : kindWrittenBy(user, found);

    if (found === null || kind === null) {
      throw new NotFoundException(`Booking ${bookingId} not found`);
    }

    if (!isReviewable(found.booking, today())) {
      throw new ConflictException(
        "A stay can be reviewed once it has been confirmed and is over",
      );
    }

    let review: Review;

    try {
      review = await this.reviewRepository.create(bookingId, kind, input);
    } catch (error) {
      if (error instanceof ReviewAlreadyWrittenError) {
        throw new ConflictException("You have already reviewed this stay");
      }

      throw error;
    }

    await this.notifyReviewed(found, review, user);

    return review;
  }

  /**
   * The other side of the stay is told — the host about the guest's half, the guest about
   * the host's. That is the person the review is about, which `kind` already names. A
   * guest who stayed at their own listing wrote about themselves, and is not told so.
   */
  private async notifyReviewed(
    { booking, listingOwnerId }: BookingWithListingOwner,
    review: Review,
    author: AuthenticatedUser,
  ): Promise<void> {
    const recipient =
      review.kind === ReviewKind.LISTING ? listingOwnerId : booking.guestId;

    if (recipient === author.id) return;

    await this.notificationService.notify(recipient, {
      type: NotificationType.REVIEW_RECEIVED,
      data: {
        reviewId: review.id,
        bookingId: booking.id,
        kind: review.kind,
        listingId: booking.listingId,
        listingTitle: booking.listing.title,
        guestId: booking.guestId,
        rating: review.rating,
      },
    });
  }

  /** Moderation, the admin's alone — `@Roles` on the route says so, and nothing here re-checks it. */
  async remove(id: string): Promise<void> {
    if (!(await this.reviewRepository.delete(id))) {
      throw new NotFoundException(`Review ${id} not found`);
    }
  }

  /**
   * The guest themselves, an admin, or a host the guest is asking or has stayed with.
   * Themselves comes first and whatever the role: an admin can change an account's role,
   * and a guest who also hosts is still the subject of what was said about their stays.
   * For any other user the answer is a read of the bookings — hosting is owning a listing,
   * not a role, so only the rows can say whether the caller hosted this guest.
   *
   * The switch is exhaustive for the reason `BookingService.pageFor` gives — a third role
   * stops compiling here instead of falling through to whichever answer is nearest.
   */
  private async mayReadGuest(
    guestId: string,
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (sameId(user.id, guestId)) return true;

    switch (user.role) {
      case Role.ADMIN:
        return true;
      case Role.USER:
        return this.bookingRepository.hasStayedWith(guestId, user.id);
      default: {
        const unknownRole: never = user.role;

        throw new ForbiddenException(
          `Unknown role ${JSON.stringify(unknownRole)}`,
        );
      }
    }
  }

  private cursorOf(kind: ReviewKind, query: ReviewQuery): ReviewCursor | null {
    return readCursor(query.cursor, query.sort, (raw) =>
      decodeCursor(kind, raw),
    );
  }

  private withCursor(
    { items, hasMore }: Page<Review>,
    query: ReviewQuery,
  ): Pick<ReviewPage, "items" | "nextCursor"> {
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last !== undefined ? encodeCursor(last, query.sort) : null,
    };
  }
}

/**
 * Which half of this stay the caller would be writing, or `null` when they are neither
 * side of it. Both halves go by the ids alone: the guest is whoever booked, and the host
 * whoever owns the listing — owning it is what being a host means, whatever the role. An
 * admin — who may read every stay — writes neither, which `@Roles` on the route already
 * says.
 */
function kindWrittenBy(
  user: AuthenticatedUser,
  { booking, listingOwnerId }: BookingWithListingOwner,
): ReviewKind | null {
  if (user.id === booking.guestId) return ReviewKind.LISTING;

  if (user.id === listingOwnerId) return ReviewKind.GUEST;

  return null;
}

/**
 * Compared lower-cased because `ParseUUIDPipe` accepts an upper-case UUID that Postgres
 * resolves to the same row — the reason `UserService` compares its own-account check the
 * same way. The id in the token is the one Postgres generated, and that one is lower-case.
 */
function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** UTC, the clock `isReviewable` is written against — see the note on it in the contract. */
function today(): string {
  return format(TZDate.tz("UTC"), "yyyy-MM-dd");
}
