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
import { addCents, centsSchema, NO_CENTS, type Cents } from "./money.js";

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
 * The day of the week a day falls on, under the contract's names. Both the ISO week and the
 * contract's start on Monday; only the ISO count starts at 1.
 */
function weekdayOf(day: string): Weekday {
  const weekday = weekdaySchema.options[getISODay(parseISO(day, IN_UTC)) - 1];

  if (weekday === undefined) throw new Error(`${day} is not a calendar day`);

  return weekday;
}
