import type { BookingAdjustment } from "@repo/contracts";
import {
  ApiResponseError,
  ApiUnreachableError,
  bookingsApi,
} from "#shared/api";

/**
 * The refunds admins sent for the stay, newest first — an admin's to read, as the route
 * behind them is. Read fresh on every render: a refund an admin sent a moment ago has to be
 * listed, and an unconfirmed press with it.
 *
 * `null` when the API refuses or cannot be reached, instead of an error, for the reason
 * `readListingReviews` gives: the stay is drawn without the list, and its status, its money
 * and the cancel button should not go down with it. A `403` lands here as well — a token
 * still claiming `ADMIN` after a demotion — and a `404` is the stay's own read beside this
 * one to answer, with the route's not-found. Anything else is a broken response rather than
 * an unavailable one, and still throws.
 */
export async function readBookingAdjustments(
  bookingId: string,
): Promise<BookingAdjustment[] | null> {
  try {
    return await bookingsApi.refunds(bookingId, { cache: "no-store" });
  } catch (error) {
    if (
      error instanceof ApiResponseError ||
      error instanceof ApiUnreachableError
    ) {
      return null;
    }

    throw error;
  }
}
