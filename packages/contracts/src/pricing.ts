import { tz } from "@date-fns/tz";
import {
  eachDayOfInterval,
  format,
  getISODay,
  isBefore,
  parseISO,
} from "date-fns";
import { z } from "zod";
import { weekdaySchema, type ListingDetail, type Weekday } from "./listing.js";
import {
  addCents,
  centsSchema,
  MAX_CHARGE,
  MIN_CHARGE,
  NO_CENTS,
  shareOf,
  subtractCents,
  type Cents,
} from "./money.js";

/**
 * What a night costs, in the order `listingPricingSchema` gives its fields. It is a rule
 * rather than a schema, and it lives here anyway: the listing page quotes a stay by it and
 * the payment of phase 6 has to charge by it, so a copy on each side of the wire would be
 * a guest quoted one total and charged another the day the two drift.
 *
 * Days are `YYYY-MM-DD` strings throughout, and the arithmetic is done in UTC — the zone
 * `@db.Date` and the rest of the contract mean by a day — so the weekday of a date is the
 * same in every runtime that asks.
 */

/** What the rule needs of a listing: its default price and the exceptions to it. */
export type PricedListing = Pick<
  ListingDetail,
  "pricePerNightCents" | "pricing"
>;

/**
 * One night of a stay, named by the day it starts on, and what it costs in cents. A schema
 * as well as a rule's result: a booking answers the nights it was quoted with
 * (`bookingDetailSchema`).
 */
export const pricedNightSchema = z.object({
  date: z.iso.date(),
  priceCents: centsSchema,
});

export type PricedNight = z.infer<typeof pricedNightSchema>;

const IN_UTC = { in: tz("UTC") };

/**
 * The price of the night that starts on `day`: a price set for that very date wins, then
 * one set for its day of the week, then the listing's default.
 */
export function nightlyPrice(listing: PricedListing, day: string): Cents {
  const { weekdays, dates } = listing.pricing;

  return (
    dates.find((entry) => entry.date === day)?.priceCents ??
    weekdays[weekdayOf(day)] ??
    listing.pricePerNightCents
  );
}

/**
 * Every night of a stay with its price, check-out exclusive — the same half-open range a
 * booking holds. An empty list for a range that is not one.
 */
export function pricedNights(
  listing: PricedListing,
  from: string,
  to: string,
): PricedNight[] {
  const start = parseISO(from, IN_UTC);
  const end = parseISO(to, IN_UTC);

  // A reversed interval is walked backwards rather than refused, hence the guard.
  if (!isBefore(start, end)) return [];

  // The interval includes its end, and the check-out day is not a night.
  return eachDayOfInterval({ start, end }, IN_UTC)
    .slice(0, -1)
    .map((day) => {
      const date = format(day, "yyyy-MM-dd");

      return { date, priceCents: nightlyPrice(listing, date) };
    });
}

/** What the nights add up to, in cents — exact, since every price is a whole number of them. */
export function stayTotal(nights: readonly PricedNight[]): Cents {
  return nights.reduce(
    (total, night) => addCents(total, night.priceCents),
    NO_CENTS,
  );
}

/**
 * The rates a stay can be booked at, mirrored by nothing in the database: a rate is a choice
 * made once, when the hold is taken, and what it decides is stored in its own terms — the
 * discount in `discount_cents` and the policy in `cancellation_policy`. `NON_REFUNDABLE` is
 * offered only by a listing with a `nonRefundableDiscountBps`.
 */
export const bookingRateSchema = z.enum(["STANDARD", "NON_REFUNDABLE"]);

export const BookingRate = bookingRateSchema.enum;

export type BookingRate = z.infer<typeof bookingRateSchema>;

/**
 * Why a hold at the non-refundable rate is refused on a listing that offers none — one
 * that never did, or withdrew it since the page was read without naming its version.
 */
export const RATE_NOT_OFFERED = "This listing offers no non-refundable rate";

/**
 * A stay as a hold stores it: every night at its own price, the discount its rate takes off,
 * and what is left to charge.
 */
export type StayQuote = {
  nights: PricedNight[];
  discountCents: Cents;
  amountCents: Cents;
};

/**
 * What a stay costs at a rate: the nights priced one by one, then the discount taken off
 * their total once, with one rounding — half up, in the guest's favour — rather than off
 * each night, where the roundings would add up to a total nobody can work back to. The
 * nights keep their undiscounted prices, so `amountCents` is their sum less `discountCents`.
 * `discountBps` is the listing's `nonRefundableDiscountBps` for that rate and `null` for
 * the standard one; whether a listing offers the rate is the caller's to check.
 *
 * Here rather than in the API so the booking form quotes both rates by the very rule the
 * hold is charged by.
 */
export function quoteStay(
  listing: PricedListing,
  from: string,
  to: string,
  discountBps: number | null = null,
): StayQuote {
  const nights = pricedNights(listing, from, to);
  const total = stayTotal(nights);
  const discountCents =
    discountBps === null ? NO_CENTS : shareOf(total, discountBps);

  return {
    nights,
    discountCents,
    amountCents: subtractCents(total, discountCents),
  };
}

/** Why a stay is refused when what it charges is more than one payment can carry. */
export const STAY_TOO_EXPENSIVE =
  "This stay costs more than one payment can carry — book fewer nights";

/** …and when it is less than one payment can carry. */
export const STAY_TOO_CHEAP =
  "This stay costs less than one payment can carry — book more nights";

/**
 * Why one payment cannot carry `amount` — between `MIN_CHARGE` and `MAX_CHARGE`, both
 * included — in the words the API refuses the hold with, or `null` when it can. Read off a
 * quote's `amountCents`, after its discount: the booking form disables a rate whose total
 * it refuses and says so under the quote, and the API answers the same words with a `422`.
 */
export function chargeRefusal(amount: Cents): string | null {
  if (amount > MAX_CHARGE) return STAY_TOO_EXPENSIVE;

  if (amount < MIN_CHARGE) return STAY_TOO_CHEAP;

  return null;
}

/**
 * The day of the week a day falls on, under the contract's names. Both the ISO week and the
 * contract's start on Monday; only the ISO count starts at 1.
 */
function weekdayOf(day: string): Weekday {
  const weekday = weekdaySchema.options[getISODay(parseISO(day, IN_UTC)) - 1];

  if (weekday === undefined) throw new Error(`${day} is not a calendar day`);

  return weekday;
}
