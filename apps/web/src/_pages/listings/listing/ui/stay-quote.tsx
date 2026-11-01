"use client";

import { useWatch, type Control } from "react-hook-form";
import {
  pricedNights,
  stayTotal,
  type CreateBookingInput,
  type PricedListing,
} from "@repo/contracts";
import {
  formatMoney,
  isDay,
  nightsBetween,
  nightsBreakdown,
} from "#shared/lib";

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
      {nightsBreakdown(nights)} ={" "}
      <span className="font-semibold">{formatMoney(stayTotal(nights))}</span>
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
