"use client";

import { useWatch, type Control } from "react-hook-form";
import {
  pricedNights,
  stayTotal,
  type CreateBookingInput,
  type PricedListing,
  type PricedNight,
} from "@repo/contracts";
import { countOf, formatMoney, isDay, nightsBetween } from "#shared/lib";

/**
 * What the dates in the booking form cost, night by night — a weekend or a date priced on
 * its own costs what the owner set for it (`nightlyPrice` in the contract). This number is
 * what the guest is told, not what they are charged: nothing about it is sent.
 *
 * It subscribes to the two dates in a component of its own, so a keystroke in a date box
 * redraws this line rather than the whole form.
 */
export const StayQuote = ({
  control,
  prices,
}: {
  control: Control<CreateBookingInput>;
  /** The default price and the exceptions to it, off the listing being booked. */
  prices: PricedListing;
}) => {
  const [from, to] = useWatch({ control, name: ["from", "to"] });

  const length = isDay(from) && isDay(to) ? nightsBetween(from, to) : 0;
  const nights =
    length > 0 && length <= QUOTED_NIGHTS ? pricedNights(prices, from, to) : [];

  if (nights.length === 0) return null;

  return (
    <p className="text-sm">
      {byPrice(nights)
        .map(
          ({ price, count }) =>
            `${countOf(count, "night")} × ${formatMoney(price)}`,
        )
        .join(" + ")}{" "}
      = <span className="font-semibold">{formatMoney(stayTotal(nights))}</span>
    </p>
  );
};

/**
 * The longest stay the form quotes as the dates are typed. A year typed a digit at a time
 * passes through 0002 on its way to 2026, and a quote of every night between would be
 * thousands of entries on a keystroke; the API refuses nothing of the kind on its own, so
 * the bound is the screen's, and a stay longer than a year gets no line rather than a slow
 * one.
 */
const QUOTED_NIGHTS = 366;

/**
 * The nights of a stay grouped by what they cost, in the order the prices first appear —
 * `2 nights × 120.00 + 1 night × 150.00` reads as a sum, where one line per night would be
 * a list as long as the stay.
 */
function byPrice(
  nights: readonly PricedNight[],
): { price: number; count: number }[] {
  const counts = new Map<number, number>();

  for (const { price } of nights) {
    counts.set(price, (counts.get(price) ?? 0) + 1);
  }

  return [...counts].map(([price, count]) => ({ price, count }));
}
