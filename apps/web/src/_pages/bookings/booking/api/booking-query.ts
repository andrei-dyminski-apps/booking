import type { BookingDetail } from "@repo/contracts";
import { bookingsApi } from "#shared/api";

/** The one key the stay's page caches its booking under; the poll and the cancel share it. */
export const bookingKey = (id: string) => ["booking", id] as const;

/**
 * The hold's payment, under a root of its own: invalidating the booking — which the poll and
 * the cancel do — must not open the payment again.
 */
export const bookingPaymentKey = (id: string) =>
  ["booking-payment", id] as const;

/** Read through the BFF like every browser request, and never from a cache. */
export const readBooking = (id: string): Promise<BookingDetail> =>
  bookingsApi.get(id, { cache: "no-store" });
