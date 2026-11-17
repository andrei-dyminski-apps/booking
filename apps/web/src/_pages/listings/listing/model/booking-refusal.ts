import { refusedWith } from "#shared/api";

/**
 * Somebody else holds some of these nights, and the calendar the visitor chose them from did
 * not know. Read off the code, not the `409` it travels with, so a second kind of conflict
 * added to the route cannot flip the form into the waitlist offer.
 */
export const isDatesUnavailable = (error: unknown): boolean =>
  refusedWith(error, "DATES_UNAVAILABLE");

/**
 * Nights the waitlist was asked for came free since the calendar was read. Read off the
 * code for the reason above: a full list is a `403`, but nothing stops another `409` being
 * added to the route, and it must not read as a stale calendar.
 */
export const isNightsAvailable = (error: unknown): boolean =>
  refusedWith(error, "NIGHTS_AVAILABLE");

/** The host changed the listing after it was shown — a `412`, not a `409`: the nights are free. */
export const isListingChanged = (error: unknown): boolean =>
  refusedWith(error, "LISTING_CHANGED_SINCE_SHOWN");
