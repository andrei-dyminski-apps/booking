import { pricedNights, stayTotal, type PricedListing } from "@repo/contracts";

/**
 * What a stay costs and in which currency it is paid — pure functions, no Nest, no Prisma.
 *
 * The rule itself is not restated here: `nightlyPrice` lives in `@repo/contracts` because
 * the listing page quotes a stay by it, and a hold charging by a second copy would be a
 * guest quoted one total and charged another the day the two drift. This file is where the
 * booking module asks it.
 */

/**
 * The most one payment can carry: Stripe takes at most eight digits of the currency's
 * minor unit (999 999.99 euros). A stay is a nightly price times a number of nights,
 * neither of them bounded by the other, so a hold quoted above this is refused rather than
 * taken — it could never be paid and would only keep its nights off the calendar until it
 * lapsed. It also keeps the quote inside `numeric(10, 2)` of `bookings.amount`.
 */
export const MAX_CHARGE = 999_999.99;

/**
 * The least one payment can carry: Stripe refuses a charge below 0.50 euros. The contract
 * lets a night cost a cent, so a short stay can come to less, and such a hold is refused
 * for the reason a stay above `MAX_CHARGE` is.
 */
export const MIN_CHARGE = 0.5;

/**
 * The total of a stay, exact to the cent: each night by the listing's own rule, check-out
 * exclusive, summed in whole cents. A range with no nights costs nothing — the contract
 * refuses one before it gets here.
 */
export function quoteStay(
  listing: PricedListing,
  from: string,
  to: string,
): number {
  return stayTotal(pricedNights(listing, from, to));
}
