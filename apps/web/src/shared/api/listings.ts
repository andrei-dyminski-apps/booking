import { z } from "zod";
import {
  listingAvailabilitySchema,
  listingDetailSchema,
  listingListSchema,
  listingPageSchema,
  listingSchema,
  type AvailabilityQuery,
  type CreateListingInput,
  type Listing,
  type ListingAvailability,
  type ListingDetail,
  type ListingPage,
  type ListingQuery,
  type UpdateListingInput,
} from "@repo/contracts";
import { apiRequest, queryString, type ReadOptions } from "./http-client";

/**
 * Every route of the listings resource, written down once the way the bookings are:
 * method, path and the schema of the answer, so no call site spells a path of its own or
 * forgets to parse what comes back.
 */
export const listingsApi = {
  /**
   * One page of the catalogue. The filters and the cursor travel in the query string
   * because that is where they live on this side too — a search is a link somebody can
   * send, which is the whole reason the API takes them as a `GET`.
   */
  page: (query: ListingQuery, read: ReadOptions): Promise<ListingPage> =>
    apiRequest({
      method: "GET",
      path: `/listings${queryString(query)}`,
      schema: listingPageSchema,
      read,
    }),

  /** The caller's own listings. The API narrows them by the session, not by a parameter. */
  mine: (read: ReadOptions): Promise<Listing[]> =>
    apiRequest({
      method: "GET",
      path: "/listings/mine",
      schema: listingListSchema,
      read,
    }),

  /**
   * One listing with the exceptions to its default price — what its own page quotes a stay
   * with and what its edit screens fill the price boxes from. A page of the catalogue
   * carries the default alone.
   */
  get: (id: string, read: ReadOptions): Promise<ListingDetail> =>
    apiRequest({
      method: "GET",
      path: `/listings/${encodeURIComponent(id)}`,
      schema: listingDetailSchema,
      read,
    }),

  /**
   * The nights already taken, for the window a calendar is drawing. It answers the same
   * question `POST /bookings` answers with a `409` and decides nothing: whether a stay is
   * possible is settled inside the transaction that locks the row, not here.
   */
  availability: (
    id: string,
    window: AvailabilityQuery,
    read: ReadOptions,
  ): Promise<ListingAvailability> =>
    apiRequest({
      method: "GET",
      path: `/listings/${encodeURIComponent(id)}/availability${queryString(window)}`,
      schema: listingAvailabilitySchema,
      read,
    }),

  create: (input: CreateListingInput): Promise<Listing> =>
    apiRequest({
      method: "POST",
      path: "/listings",
      schema: listingSchema,
      body: input,
    }),

  update: (id: string, input: UpdateListingInput): Promise<Listing> =>
    apiRequest({
      method: "PATCH",
      path: `/listings/${encodeURIComponent(id)}`,
      schema: listingSchema,
      body: input,
    }),

  remove: (id: string): Promise<void> =>
    apiRequest({
      method: "DELETE",
      path: `/listings/${encodeURIComponent(id)}`,
      schema: z.void(),
    }),
};
