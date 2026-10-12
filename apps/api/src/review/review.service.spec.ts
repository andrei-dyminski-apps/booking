import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { tz } from "@date-fns/tz";
import { Test } from "@nestjs/testing";
import { addDays, format } from "date-fns";
import { randomUUID } from "node:crypto";
import {
  BookingStatus,
  NotificationType,
  reviewQuerySchema,
  ReviewKind,
  Role,
  type Booking,
  type CreateReviewInput,
  type Listing,
  type NotificationContent,
  type Review,
  type ReviewQuery,
  type ReviewSummary,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import {
  BookingRepository,
  type BookingWithListingOwner,
} from "../booking/booking.repository";
import type { Page } from "../common/paging";
import { ListingRepository } from "../listing/listing.repository";
import { NotificationService } from "../notification/notification.service";
import type { ReviewCursor } from "./review-cursor";
import {
  ReviewAlreadyWrittenError,
  ReviewRepository,
} from "./review.repository";
import { ReviewService } from "./review.service";

const GUEST_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const OWNER_ID = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";
const OTHER_OWNER_ID = "8f2b4e3a-3c4d-4e5f-8a7b-1c2d3e4f5061";
const STRANGER_ID = "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f50";
const LISTING_ID = "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b";
const RETIRED_LISTING_ID = "3a4b5c6d-7e8f-4091-8a2b-3c4d5e6f7a8b";

const userWith = (id: string, role: Role): AuthenticatedUser => ({
  id,
  email: "someone@example.com",
  role,
});

const guest = userWith(GUEST_ID, Role.USER);
const owner = userWith(OWNER_ID, Role.OWNER);
const otherOwner = userWith(OTHER_OWNER_ID, Role.OWNER);
const stranger = userWith(STRANGER_ID, Role.USER);
const admin = userWith(STRANGER_ID, Role.ADMIN);

const input: CreateReviewInput = {
  rating: 4,
  comment: "A lovely stay, the kitchen was a joy.",
};

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
type PublicOf<T> = { [K in keyof T]: T[K] };

const query = (search: Record<string, string> = {}): ReviewQuery =>
  reviewQuerySchema.parse(search);

/**
 * A day relative to the one the suite runs on, in UTC — `isReviewable` reads the real
 * clock through the service, so a date written down would pass until it arrived and then
 * flip every assertion about "over".
 */
const inDays = (days: number): string =>
  format(addDays(new Date(), days, { in: tz("UTC") }), "yyyy-MM-dd");

/** A stay `guest` took against `owner`'s listing, as the booking repository resolves it. */
const stay = (overrides: Partial<Booking> = {}): BookingWithListingOwner => ({
  booking: {
    id: randomUUID(),
    listingId: LISTING_ID,
    listing: { title: "Loft above the harbour", pricePerNight: 120 },
    guestId: GUEST_ID,
    from: inDays(-5),
    to: inDays(-1),
    status: BookingStatus.CONFIRMED,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    reviewed: { byGuest: false, byOwner: false },
    ...overrides,
  },
  listingOwnerId: OWNER_ID,
});

type StoredReview = { review: Review; booking: Booking };

/**
 * The queries are the repository's and are covered by e2e. What the fake has to model is
 * what the rules act on: one review of each kind per stay — the unique key the real one
 * translates — and the two lists reached through the booking, newest first.
 */
class FakeReviewRepository implements PublicOf<ReviewRepository> {
  readonly rows: StoredReview[] = [];

  constructor(private readonly bookings: FakeBookingRepository) {}

  findPageForListing(
    listingId: string,
    reviewQuery: ReviewQuery,
    cursor: ReviewCursor | null,
  ): Promise<Page<Review>> {
    return this.pageOf(this.aboutListing(listingId), reviewQuery, cursor);
  }

  findPageForGuest(
    guestId: string,
    reviewQuery: ReviewQuery,
    cursor: ReviewCursor | null,
  ): Promise<Page<Review>> {
    return this.pageOf(this.aboutGuest(guestId), reviewQuery, cursor);
  }

  summaryForListing(listingId: string): Promise<ReviewSummary> {
    return Promise.resolve(summaryOf(this.aboutListing(listingId)));
  }

  summaryForGuest(guestId: string): Promise<ReviewSummary> {
    return Promise.resolve(summaryOf(this.aboutGuest(guestId)));
  }

  create(
    bookingId: string,
    kind: ReviewKind,
    review: CreateReviewInput,
  ): Promise<Review> {
    const booking = this.bookings.rows.get(bookingId)?.booking;

    if (booking === undefined) {
      return Promise.reject(new Error(`No booking ${bookingId} in the fake`));
    }

    if (
      this.rows.some(
        (row) => row.booking.id === bookingId && row.review.kind === kind,
      )
    ) {
      return Promise.reject(new ReviewAlreadyWrittenError(bookingId, kind));
    }

    const stored: Review = {
      id: randomUUID(),
      kind,
      ...review,
      createdAt: new Date(
        Date.parse("2026-09-01T12:00:00.000Z") + this.rows.length * 1_000,
      ).toISOString(),
    };

    this.rows.push({ review: stored, booking });

    return Promise.resolve(stored);
  }

  delete(id: string): Promise<boolean> {
    const index = this.rows.findIndex((row) => row.review.id === id);

    if (index === -1) return Promise.resolve(false);

    this.rows.splice(index, 1);

    return Promise.resolve(true);
  }

  private aboutListing(listingId: string): Review[] {
    return this.rows
      .filter(
        (row) =>
          row.review.kind === ReviewKind.LISTING &&
          row.booking.listingId === listingId,
      )
      .map((row) => row.review);
  }

  private aboutGuest(guestId: string): Review[] {
    return this.rows
      .filter(
        (row) =>
          row.review.kind === ReviewKind.GUEST &&
          row.booking.guestId === guestId,
      )
      .map((row) => row.review);
  }

  private pageOf(
    reviews: Review[],
    reviewQuery: ReviewQuery,
    cursor: ReviewCursor | null,
  ): Promise<Page<Review>> {
    const ordered = [...reviews].sort((left, right) =>
      reviewQuery.sort === "newest"
        ? right.createdAt.localeCompare(left.createdAt)
        : left.createdAt.localeCompare(right.createdAt),
    );
    const start =
      cursor === null
        ? 0
        : ordered.findIndex((review) => review.id === cursor.id) + 1;

    return Promise.resolve({
      items: ordered.slice(start, start + reviewQuery.limit),
      hasMore: ordered.length > start + reviewQuery.limit,
    });
  }
}

function summaryOf(reviews: Review[]): ReviewSummary {
  if (reviews.length === 0) return { count: 0, average: null };

  const total = reviews.reduce((sum, review) => sum + review.rating, 0);

  return {
    count: reviews.length,
    average: Math.round((total / reviews.length) * 10) / 10,
  };
}

class FakeBookingRepository implements Pick<
  PublicOf<BookingRepository>,
  "findByIdWithListingOwner" | "hasStayedWith"
> {
  readonly rows = new Map<string, BookingWithListingOwner>();

  add(found: BookingWithListingOwner): string {
    this.rows.set(found.booking.id, found);

    return found.booking.id;
  }

  findByIdWithListingOwner(
    id: string,
  ): Promise<BookingWithListingOwner | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  /** `holdsTheSlot`: confirmed, or a hold whose deadline is still ahead. */
  hasStayedWith(guestId: string, ownerId: string): Promise<boolean> {
    const now = Date.now();

    return Promise.resolve(
      [...this.rows.values()].some(
        ({ booking, listingOwnerId }) =>
          booking.guestId === guestId &&
          listingOwnerId === ownerId &&
          (booking.status === BookingStatus.CONFIRMED ||
            (booking.status === BookingStatus.PENDING_PAYMENT &&
              booking.expiresAt !== null &&
              Date.parse(booking.expiresAt) > now)),
      ),
    );
  }
}

/** Offered or not is all the service asks of a listing. */
class FakeListingRepository implements Pick<
  PublicOf<ListingRepository>,
  "findById"
> {
  findById(id: string): Promise<Listing | null> {
    if (id !== LISTING_ID) return Promise.resolve(null);

    return Promise.resolve({
      id,
      ownerId: OWNER_ID,
      title: "Loft above the harbour",
      description: "Two rooms under the roof and a wall of glass.",
      pricePerNight: 120,
      capacity: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}

/** Who was told what — the storing and pushing are `notification.service.spec.ts`'s. */
class FakeNotificationService implements Pick<NotificationService, "notify"> {
  readonly notices: { userId: string; content: NotificationContent }[] = [];

  notify(userId: string, content: NotificationContent): Promise<void> {
    this.notices.push({ userId, content });

    return Promise.resolve();
  }
}

describe("ReviewService", () => {
  let service: ReviewService;
  let reviewRepository: FakeReviewRepository;
  let bookingRepository: FakeBookingRepository;
  let notificationService: FakeNotificationService;

  beforeEach(async () => {
    bookingRepository = new FakeBookingRepository();
    reviewRepository = new FakeReviewRepository(bookingRepository);
    notificationService = new FakeNotificationService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewService,
        { provide: ReviewRepository, useValue: reviewRepository },
        { provide: BookingRepository, useValue: bookingRepository },
        { provide: ListingRepository, useValue: new FakeListingRepository() },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = moduleRef.get(ReviewService);
  });

  it("lets the guest review the listing and its owner review the guest", async () => {
    const bookingId = bookingRepository.add(stay());

    await expect(service.create(bookingId, guest, input)).resolves.toEqual(
      expect.objectContaining({ kind: ReviewKind.LISTING, rating: 4 }),
    );
    await expect(service.create(bookingId, owner, input)).resolves.toEqual(
      expect.objectContaining({ kind: ReviewKind.GUEST }),
    );
  });

  it("tells the side of the stay a review is about, and nobody else", async () => {
    const bookingId = bookingRepository.add(stay());

    await service.create(bookingId, guest, input);
    await service.create(bookingId, owner, input);

    expect(
      notificationService.notices.map(({ userId, content }) => ({
        userId,
        type: content.type,
        kind:
          content.type === NotificationType.REVIEW_RECEIVED &&
          content.data.kind,
      })),
    ).toEqual([
      {
        userId: OWNER_ID,
        type: NotificationType.REVIEW_RECEIVED,
        kind: ReviewKind.LISTING,
      },
      {
        userId: GUEST_ID,
        type: NotificationType.REVIEW_RECEIVED,
        kind: ReviewKind.GUEST,
      },
    ]);
  });

  it("does not tell an owner about a review of their own listing they wrote", async () => {
    const bookingId = bookingRepository.add(stay({ guestId: OWNER_ID }));

    await service.create(bookingId, owner, input);

    expect(notificationService.notices).toEqual([]);
  });

  it("refuses a second review of the same half of a stay", async () => {
    const bookingId = bookingRepository.add(stay());

    await service.create(bookingId, guest, input);

    await expect(service.create(bookingId, guest, input)).rejects.toThrow(
      ConflictException,
    );
  });

  it("refuses a stay that has not ended, or never happened", async () => {
    for (const overrides of [
      { from: inDays(-1), to: inDays(2) },
      { from: inDays(3), to: inDays(5) },
      { status: BookingStatus.CANCELLED },
      { status: BookingStatus.EXPIRED },
      { status: BookingStatus.PENDING_PAYMENT },
    ] satisfies Partial<Booking>[]) {
      const bookingId = bookingRepository.add(stay(overrides));

      await expect(service.create(bookingId, guest, input)).rejects.toThrow(
        ConflictException,
      );
    }
  });

  it("opens the review on the check-out day itself", async () => {
    const bookingId = bookingRepository.add(
      stay({ from: inDays(-3), to: inDays(0) }),
    );

    await expect(service.create(bookingId, guest, input)).resolves.toEqual(
      expect.objectContaining({ kind: ReviewKind.LISTING }),
    );
  });

  it("answers 404 to anybody who is neither side of the stay", async () => {
    const bookingId = bookingRepository.add(stay());

    for (const user of [stranger, otherOwner]) {
      await expect(service.create(bookingId, user, input)).rejects.toThrow(
        NotFoundException,
      );
    }

    await expect(service.create(randomUUID(), guest, input)).rejects.toThrow(
      NotFoundException,
    );
    expect(reviewRepository.rows).toHaveLength(0);
  });

  it("shows a listing's reviews with the summary of all of them, not of the page", async () => {
    for (const rating of [5, 4, 4]) {
      await service.create(bookingRepository.add(stay()), guest, {
        ...input,
        rating,
      });
    }

    const page = await service.findListingPage(
      LISTING_ID,
      query({ limit: "2" }),
    );

    expect(page.items).toHaveLength(2);
    expect(page.summary).toEqual({ count: 3, average: 4.3 });
    expect(page.nextCursor).not.toBeNull();

    const rest = await service.findListingPage(
      LISTING_ID,
      query({ limit: "2", cursor: page.nextCursor ?? "" }),
    );

    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
  });

  it("keeps the host's half out of the listing's reviews", async () => {
    const bookingId = bookingRepository.add(stay());

    await service.create(bookingId, owner, input);

    await expect(
      service.findListingPage(LISTING_ID, query()),
    ).resolves.toMatchObject({
      items: [],
      summary: { count: 0, average: null },
    });
  });

  it("answers 404 for the reviews of a retired listing", async () => {
    await expect(
      service.findListingPage(RETIRED_LISTING_ID, query()),
    ).rejects.toThrow(NotFoundException);
  });

  it("refuses a cursor issued by the other list of reviews", async () => {
    for (const rating of [5, 4]) {
      const bookingId = bookingRepository.add(stay());

      await service.create(bookingId, owner, { ...input, rating });
    }

    const { nextCursor } = await service.findGuestPage(
      GUEST_ID,
      admin,
      query({ limit: "1" }),
    );

    await expect(
      service.findListingPage(
        LISTING_ID,
        query({ limit: "1", cursor: nextCursor ?? "" }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("shows a guest's reviews to the guest, an admin and the hosts they booked with", async () => {
    await service.create(bookingRepository.add(stay()), owner, input);

    for (const user of [guest, admin, owner]) {
      await expect(
        service.findGuestPage(GUEST_ID, user, query()),
      ).resolves.toMatchObject({ summary: { count: 1, average: 4 } });
    }
  });

  it("hides a guest's reviews from other guests and from hosts they never asked", async () => {
    await service.create(bookingRepository.add(stay()), owner, input);

    for (const user of [stranger, otherOwner]) {
      await expect(
        service.findGuestPage(GUEST_ID, user, query()),
      ).rejects.toThrow(NotFoundException);
    }
  });

  it("lets a host read a guest who only holds a stay with them, before it happens", async () => {
    bookingRepository.add(
      stay({
        status: BookingStatus.PENDING_PAYMENT,
        from: inDays(10),
        to: inDays(12),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );

    await expect(
      service.findGuestPage(GUEST_ID, owner, query()),
    ).resolves.toMatchObject({ items: [] });
  });

  it("closes a guest's reviews to a host once the only request has lapsed, been cancelled or expired", async () => {
    const future = { from: inDays(10), to: inDays(12) };

    bookingRepository.add(
      stay({
        ...future,
        status: BookingStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    bookingRepository.add(stay({ ...future, status: BookingStatus.CANCELLED }));
    bookingRepository.add(stay({ ...future, status: BookingStatus.EXPIRED }));

    await expect(
      service.findGuestPage(GUEST_ID, owner, query()),
    ).rejects.toThrow(NotFoundException);
  });

  it("keeps a guest made a host the subject and the author of their own stays", async () => {
    const promoted = userWith(GUEST_ID, Role.OWNER);
    const bookingId = bookingRepository.add(stay());

    await service.create(bookingId, owner, input);

    await expect(
      service.create(bookingId, promoted, input),
    ).resolves.toMatchObject({ kind: ReviewKind.LISTING });
    await expect(
      service.findGuestPage(GUEST_ID, promoted, query()),
    ).resolves.toMatchObject({ summary: { count: 1 } });
  });

  it("removes a review, and answers 404 the second time", async () => {
    const review = await service.create(
      bookingRepository.add(stay()),
      guest,
      input,
    );

    await service.remove(review.id);

    expect(reviewRepository.rows).toHaveLength(0);
    await expect(service.remove(review.id)).rejects.toThrow(NotFoundException);
  });
});
