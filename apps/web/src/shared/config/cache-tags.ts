/**
 * The names the catalogue's cached reads are stored under, in one place for the same
 * reason `ROUTES` is: a tag is a string agreed between the read that carries it and the
 * mutation that invalidates it, and nothing checks that the two spell it the same way.
 * A typo in either half is a page that never updates, or one that updates for nothing.
 *
 * Only public data is tagged. A personal read is `no-store` and never tagged at all —
 * the Data Cache is keyed by URL and shared between visitors, so a tag on one person's
 * bookings would only make it easier to serve them to the next.
 *
 * The three of them are separate because the writes are: editing a listing changes the
 * row and the catalogue but not who has booked it, and taking a booking changes what is
 * free without touching the row at all.
 */

/** Every page of `GET /listings`. A listing created, edited or retired changes all of them. */
export const CATALOGUE_TAG = "catalogue";

/** One row of the catalogue, as `GET /listings/:id` answers it. */
export const listingTag = (id: string): string => `listing:${id}`;

/**
 * What guests have said about one listing — a review's business, and neither the row's
 * nor the calendar's: writing one changes nothing else about the listing.
 */
export const listingReviewsTag = (id: string): string =>
  `listing:${id}:reviews`;

/** The nights taken against one listing — a booking's business, not the row's. */
export const availabilityTag = (id: string): string =>
  `listing:${id}:availability`;
