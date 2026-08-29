import { z } from "zod";
import {
  listingAvailabilitySchema,
  listingListSchema,
  listingPageSchema,
  listingSchema,
  type AvailabilityQuery,
  type CreateListingInput,
  type Listing,
  type ListingAvailability,
  type ListingPage,
  type ListingQuery,
  type UpdateListingInput,
} from "@repo/contracts";
import { apiRequest, type ReadOptions } from "./http-client";

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

  get: (id: string, read: ReadOptions): Promise<Listing> =>
    apiRequest({
      method: "GET",
      path: `/listings/${encodeURIComponent(id)}`,
      schema: listingSchema,
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

/**
 * The query string of a read, and the second half of the Data Cache key it is stored
 * under — which is why the parameters are sorted rather than left in the order the object
 * happened to carry them. Two callers asking the same question have to produce the same
 * URL, or each of them warms a cache entry the other never reads.
 *
 * An absent filter is left out entirely rather than sent empty. The contract reads `from=`
 * as the absence it means, so either spelling is answered the same way — but they are two
 * different URLs, and this is the side that decides which of them the cache is keyed by.
 */
function queryString(
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();

  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;

    search.set(name, String(value));
  }

  search.sort();

  const query = search.toString();

  return query === "" ? "" : `?${query}`;
}
