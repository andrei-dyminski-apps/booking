import { z } from "zod";
import {
  bookingDetailSchema,
  bookingPageSchema,
  bookingPaymentSchema,
  bookingSchema,
  stuckStayPageSchema,
  type Booking,
  type BookingDetail,
  type BookingPage,
  type BookingPayment,
  type BookingQuery,
  type CreateBookingInput,
  type StuckKind,
  type StuckStayPage,
  type StuckStayQuery,
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

  /** One stay with the nights its amount adds up from. */
  get: (id: string, read: ReadOptions): Promise<BookingDetail> =>
    apiRequest({
      method: "GET",
      path: `/bookings/${encodeURIComponent(id)}`,
      schema: bookingDetailSchema,
      read,
    }),

  /**
   * What the guest pays for a hold with — the PaymentIntent's secret. A `POST`: the first
   * call opens the intent at Stripe, and every call after it answers the same one.
   */
  payment: (id: string): Promise<BookingPayment> =>
    apiRequest({
      method: "POST",
      path: `/bookings/${encodeURIComponent(id)}/payment`,
      schema: bookingPaymentSchema,
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

  /** The stays whose owed refund or host payout stopped retrying — the admin's alone. */
  stuck: (query: StuckStayQuery, read: ReadOptions): Promise<StuckStayPage> =>
    apiRequest({
      method: "GET",
      path: `/bookings/stuck${queryString(query)}`,
      schema: stuckStayPageSchema,
      read,
    }),

  /** Hands the stuck refund or payout back to its job, which sends it at once. */
  retryStuck: (id: string, kind: StuckKind): Promise<void> =>
    apiRequest({
      method: "POST",
      path: `/bookings/${encodeURIComponent(id)}/stuck/${kind}/retry`,
      schema: z.void(),
    }),
};
