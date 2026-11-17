import { refusedWith } from "#shared/api";

/** Another request is opening this very payment: the one answer worth asking again for. */
export const isBeingOpened = (error: unknown): boolean =>
  refusedWith(error, "PAYMENT_BEING_OPENED");

/** The hold moved on — paid, cancelled or lapsed — and nothing will open a payment for it. */
export const isNoLongerWaiting = (error: unknown): boolean =>
  refusedWith(error, "BOOKING_NOT_AWAITING_PAYMENT");

/**
 * Whether a payment that failed with this was a `409` the page has to read the booking again
 * for — both reasons are, since the hold may have moved on either way.
 */
export const isHoldRefusal = (error: unknown): boolean =>
  isBeingOpened(error) || isNoLongerWaiting(error);
