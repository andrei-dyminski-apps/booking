import { z } from "zod";
import {
  bookingPageSchema,
  bookingSchema,
  type Booking,
  type BookingPage,
  type BookingQuery,
  type CreateBookingInput,
} from "@repo/contracts";
import { apiRequest, queryString, type ReadOptions } from "./http-client";

/**
 * Every route of the bookings resource is written down here once — method, path and the
 * schema of its answer — so no call site can forget to parse the response or spell a
 * path of its own. A new endpoint is a method here, not a `fetch` in a component.
 *
 * CRUD over a resource is infrastructure rather than a domain model, which is why it sits
 * in `shared/api` and not in an entity slice of its own.
 */
export const bookingsApi = {
  /**
   * One page of the stays the caller may see. The scope is the session's — the API narrows
   * by role rather than by a parameter — and what travels in the query string is the
   * filters, the ordering and the cursor of the previous page.
   */
  page: (query: BookingQuery, read: ReadOptions): Promise<BookingPage> =>
    apiRequest({
      method: "GET",
      path: `/bookings${queryString(query)}`,
      schema: bookingPageSchema,
      read,
    }),

  get: (id: string, read: ReadOptions): Promise<Booking> =>
    apiRequest({
      method: "GET",
      path: `/bookings/${encodeURIComponent(id)}`,
      schema: bookingSchema,
      read,
    }),

  create: (input: CreateBookingInput): Promise<Booking> =>
    apiRequest({
      method: "POST",
      path: "/bookings",
      schema: bookingSchema,
      body: input,
    }),

  remove: (id: string): Promise<void> =>
    apiRequest({
      method: "DELETE",
      path: `/bookings/${encodeURIComponent(id)}`,
      schema: z.void(),
    }),
};
