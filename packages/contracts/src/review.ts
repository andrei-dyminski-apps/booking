import { z } from "zod";
import { BookingStatus, type Booking } from "./booking.js";
import { blank, PAGING } from "./query.js";

/**
 * Which side of a stay a review is about, and therefore who wrote it — the two are one
 * fact, so the row carries no author of its own. `LISTING` is the guest's word on where
 * they stayed and is public; `GUEST` is the host's word on who stayed, and is read only by
 * the guest it is about, by the hosts that guest has booked with, and by an admin.
 *
 * One of each per booking: a stay is one experience on each side, and a second review of
 * the same stay would be a way to weigh one opinion twice.
 */
export const reviewKindSchema = z.enum(["LISTING", "GUEST"]);

/** The two names as a runtime value, the way `BookingStatus` is derived from its schema. */
export const ReviewKind = reviewKindSchema.enum;

/**
 * Stars, whole ones. The bounds are written on the column as well
 * (`reviews_rating_within_contract`), for the writes that go around the API — the same
 * pairing `MAX_PRICE` has with its `CHECK`.
 */
export const MIN_RATING = 1;
export const MAX_RATING = 5;

const ratingSchema = z
  .int({
    error: (issue) => {
      if (issue.code !== "invalid_type") return undefined;

      return issue.input === undefined
        ? "A rating is required"
        : "A rating must be a whole number of stars";
    },
  })
  .min(MIN_RATING, {
    error: `A rating is at least ${String(MIN_RATING)} star`,
  })
  .max(MAX_RATING, {
    error: `A rating is at most ${String(MAX_RATING)} stars`,
  });

/**
 * One review as anybody who may read it sees it. Nothing about the author is on it, and
 * that is deliberate rather than missing: the author is implied by `kind`, and the only
 * thing an account carries that could name them is its address, which is not for strangers
 * reading a listing. The booking it was written against stays off as well — its id would
 * be a handle on somebody's stay that the reader has no right to resolve.
 */
export const reviewSchema = z.object({
  id: z.uuid(),
  kind: reviewKindSchema,
  rating: ratingSchema,
  comment: z.string(),
  createdAt: z.iso.datetime(),
});

/**
 * What a request may say. The kind is not on it: it follows from who is writing — the
 * guest of the stay reviews the listing, its host reviews the guest — and a field the
 * client could set would be a way for a guest to write the host's half.
 */
export const createReviewSchema = z.object({
  rating: ratingSchema,
  comment: z
    .string()
    .trim()
    .min(10, { error: "A review needs at least 10 characters" })
    .max(1000, { error: "A review may not be longer than 1000 characters" }),
});

/**
 * Whether a stay is one somebody can review yet: paid for, and over. A hold, a cancelled
 * stay and an expired one never happened, and a stay still in progress has not finished
 * happening. "Over" is the check-out day, which is when a guest leaves.
 *
 * `today` is an argument rather than read here, for the reason `createBookingSchema` gives
 * about its own clock: a calendar day needs a zone chosen for it, UTC is the one both
 * sides share, and the frontend computes it on the server so the button and the API agree
 * about the same day.
 */
export function isReviewable(
  booking: Pick<Booking, "status" | "to">,
  today: string,
): boolean {
  return booking.status === BookingStatus.CONFIRMED && booking.to <= today;
}

/** Newest first by default: what was said last is the closest to what the place is now. */
export const reviewSortSchema = z.enum(["newest", "oldest"]);

/** The query of both review lists — the ordering and the two parameters of a keyset page. */
export const reviewQuerySchema = z.object({
  sort: blank(reviewSortSchema.default("newest")),
  ...PAGING,
});

/**
 * The count and the mean of every review of one listing or one guest, not of the page:
 * a summary of twenty rows would change as somebody pages. `average` is `null` when there
 * is nothing to average, which a `0` would misstate as the worst possible score.
 */
export const reviewSummarySchema = z.object({
  count: z.int().min(0),
  average: z.number().min(MIN_RATING).max(MAX_RATING).nullable(),
});

export const reviewPageSchema = z.object({
  items: z.array(reviewSchema),
  nextCursor: z.string().nullable(),
  summary: reviewSummarySchema,
});

export type ReviewKind = z.infer<typeof reviewKindSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type ReviewSort = z.infer<typeof reviewSortSchema>;
export type ReviewQuery = z.infer<typeof reviewQuerySchema>;
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;
export type ReviewPage = z.infer<typeof reviewPageSchema>;
