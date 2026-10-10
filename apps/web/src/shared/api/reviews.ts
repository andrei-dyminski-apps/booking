import { z } from "zod";
import {
  reviewPageSchema,
  reviewSchema,
  type CreateReviewInput,
  type Review,
  type ReviewPage,
  type ReviewQuery,
} from "@repo/contracts";
import { apiRequest, queryString, type ReadOptions } from "./http-client";

/**
 * The routes of the reviews, written down once like every other resource. Two of them
 * hang off a listing and a guest because that is what the API names them by; the
 * difference between the two lists is who may read them, and that is the API's to decide.
 */
export const reviewsApi = {
  /** The guests' reviews of one listing — public, so it is the read a page caches. */
  ofListing: (
    listingId: string,
    query: ReviewQuery,
    read: ReadOptions,
  ): Promise<ReviewPage> =>
    apiRequest({
      method: "GET",
      path: `/listings/${encodeURIComponent(listingId)}/reviews${queryString(query)}`,
      schema: reviewPageSchema,
      read,
    }),

  /** The hosts' reviews of one guest — scoped to the session, never cached. */
  ofGuest: (
    guestId: string,
    query: ReviewQuery,
    read: ReadOptions,
  ): Promise<ReviewPage> =>
    apiRequest({
      method: "GET",
      path: `/guests/${encodeURIComponent(guestId)}/reviews${queryString(query)}`,
      schema: reviewPageSchema,
      read,
    }),

  /** Which half of the stay this writes is decided by the API from the session. */
  create: (bookingId: string, input: CreateReviewInput): Promise<Review> =>
    apiRequest({
      method: "POST",
      path: `/bookings/${encodeURIComponent(bookingId)}/reviews`,
      schema: reviewSchema,
      body: input,
    }),

  remove: (id: string): Promise<void> =>
    apiRequest({
      method: "DELETE",
      path: `/reviews/${encodeURIComponent(id)}`,
      schema: z.void(),
    }),
};
