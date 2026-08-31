import type { BookingPage, BookingQuery } from "@repo/contracts";
import {
  bookingsApi,
  pageOrNullOnStaleCursor,
  type ReadOptions,
} from "#shared/api";

/**
 * Personal, so it is never cached and carries no tag: the Data Cache is keyed by URL and
 * shared between visitors, and the scope of this read is the session rather than the
 * address — two people asking `/bookings?sort=newest` are asking two different questions.
 */
const BOOKINGS_READ: ReadOptions = { cache: "no-store" };

/**
 * One page of stays, or `null` for a cursor this API will not read — the recovery itself,
 * and why it is a `null` rather than a silent first page, is in `pageOrNullOnStaleCursor`.
 */
export async function readBookingsPage(
  query: BookingQuery,
): Promise<BookingPage | null> {
  return pageOrNullOnStaleCursor(
    () => bookingsApi.page(query, BOOKINGS_READ),
    query.cursor,
  );
}
