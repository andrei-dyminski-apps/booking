import { z } from "zod";
import {
  listingListSchema,
  listingSchema,
  type CreateListingInput,
  type Listing,
  type UpdateListingInput,
} from "@repo/contracts";
import { apiRequest, type ReadOptions } from "./http-client";

/**
 * Every route of the listings resource, written down once the way the bookings are:
 * method, path and the schema of the answer, so no call site spells a path of its own or
 * forgets to parse what comes back.
 *
 * What is here is what the owner's dashboard calls. `GET /listings` — the whole catalogue
 * — is deliberately absent: it is read by the browsing screens of phase 6, together with
 * the filters and the pagination that decide its signature, and a method nobody calls
 * would be a guess about that signature rather than a description of it.
 */
export const listingsApi = {
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
