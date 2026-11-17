import { refusedWith } from "#shared/api";

/**
 * Somebody else holds some of these nights, and the calendar the visitor chose them from did
 * not know. Read off the code, not the `409` it travels with, so a second kind of conflict
 * added to the route cannot flip the form into the waitlist offer.
 */
export const isDatesUnavailable = (error: unknown): boolean =>
  refusedWith(error, "DATES_UNAVAILABLE");

/** The host changed the listing after it was shown — a `412`, not a `409`: the nights are free. */
export const isListingChanged = (error: unknown): boolean =>
  refusedWith(error, "LISTING_CHANGED_SINCE_SHOWN");
