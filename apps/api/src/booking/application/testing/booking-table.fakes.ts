import type {
  BookingWithListingOwner,
  ReleasedHold,
} from "../../domain/booking.types";
import { stayNoticeOf } from "../stay-notices";

/**
 * The `bookings` table the three repository fakes read and write, as the three repositories
 * share one table: a stay `FakeBookingRepository` created is the one
 * `FakeBookingCancellationRepository` cancels and `FakeBookingRefundRepository` refunds.
 */
export class FakeBookingTable {
  readonly rows = new Map<string, BookingWithListingOwner>();

  /**
   * Run just before `cancel` or `attachPayment` writes, as a request racing the one under
   * test would between its read and its write.
   */
  racing: ((id: string) => Promise<unknown>) | null = null;

  /** The stays whose confirmation both sides were told of. */
  readonly announced = new Set<string>();
}

export function holdOf({
  booking,
  listingOwnerId,
  paymentId,
}: BookingWithListingOwner): ReleasedHold {
  return {
    stay: stayNoticeOf(booking),
    guestId: booking.guestId,
    listingOwnerId,
    paymentId,
  };
}
