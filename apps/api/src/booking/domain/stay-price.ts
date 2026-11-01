import {
  pricedNights,
  stayTotal,
  type PricedListing,
  type PricedNight,
} from "@repo/contracts";
import { cents, type Cents } from "../../payment/domain/money";

/**
 * The rule is `nightlyPrice` in `@repo/contracts`, which the listing page quotes by too: a
 * second copy here would quote one total and charge another the day the two drift.
 */

/**
 * Stripe's ceiling for one charge (eight digits of cents). A hold above it could never be
 * paid and would only keep its nights off the calendar until it lapsed. The contract's
 * `MAX_PRICE` is the same number, so a single night at the ceiling still fits.
 */
export const MAX_CHARGE = cents(99_999_999);

/** Stripe's floor for one charge; the contract lets a night cost a cent. */
export const MIN_CHARGE = cents(50);

/** The nights of a stay with their prices, and their sum — what a hold stores, both. */
export type StayQuote = {
  nights: PricedNight[];
  amountCents: Cents;
};

export function quoteStay(
  listing: PricedListing,
  from: string,
  to: string,
): StayQuote {
  const nights = pricedNights(listing, from, to);

  return { nights, amountCents: stayTotal(nights) };
}
