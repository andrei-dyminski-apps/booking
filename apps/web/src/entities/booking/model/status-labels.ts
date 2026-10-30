import { BookingStatus } from "@repo/contracts";

/**
 * The four states of a stay, named for a person. Keyed by the contract's own enum, so a
 * fifth status stops compiling here rather than appearing as a blank option — and read by
 * the badge on every card and on a stay's own page as well as by the filter, because a
 * status called one thing in the box and another on the row is two names for one value.
 */
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  [BookingStatus.PENDING_PAYMENT]: "Awaiting payment",
  [BookingStatus.CONFIRMED]: "Confirmed",
  [BookingStatus.CANCELLED]: "Cancelled",
  [BookingStatus.EXPIRED]: "Lapsed",
};
