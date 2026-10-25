import { pricedNights, stayTotal, type PricedListing } from "@repo/contracts";

/**
 * The rule is `nightlyPrice` in `@repo/contracts`, which the listing page quotes by too: a
 * second copy here would quote one total and charge another the day the two drift.
 */

/**
 * Stripe's ceiling for one charge (eight digits of cents). A hold above it could never be
 * paid and would only keep its nights off the calendar until it lapsed.
 */
export const MAX_CHARGE = 999_999.99;

/** Stripe's floor for one charge; the contract lets a night cost a cent. */
export const MIN_CHARGE = 0.5;

export function quoteStay(
  listing: PricedListing,
  from: string,
  to: string,
): number {
  return stayTotal(pricedNights(listing, from, to));
}
