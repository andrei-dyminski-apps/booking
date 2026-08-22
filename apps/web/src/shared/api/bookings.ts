import { z } from "zod";
import {
  bookingListSchema,
  bookingSchema,
  type Booking,
  type CreateBookingInput,
} from "@repo/contracts";
import { apiRequest, type ReadOptions } from "./http-client";

/**
 * Every route of the bookings resource is written down here once — method, path and the
 * schema of its answer — so no call site can forget to parse the response or spell a
 * path of its own. A new endpoint is a method here, not a `fetch` in a component.
 *
 * CRUD over a resource is infrastructure rather than a domain model, which is why it sits
 * in `shared/api` and not in an entity slice of its own.
 */
export const bookingsApi = {
  list: (read: ReadOptions): Promise<Booking[]> =>
    apiRequest({
      method: "GET",
      path: "/bookings",
      schema: bookingListSchema,
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
