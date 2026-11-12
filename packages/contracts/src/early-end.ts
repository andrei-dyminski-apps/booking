import { tz } from "@date-fns/tz";
import { addDays, format, isBefore, parseISO } from "date-fns";
import { z } from "zod";
import { BookingStatus, type Booking } from "./booking.js";
import { CANCELLATION_TERMS } from "./cancellation-policy.js";
import { checkInInstant, stayDay, type CheckIn } from "./check-in.js";
import {
  addCents,
  BASIS_POINTS,
  cents,
  centsSchema,
  minCents,
  NO_CENTS,
  type Cents,
} from "./money.js";
import { stayTotal, type PricedNight } from "./pricing.js";
import { notRefunded } from "./refund.js";

/**
 * Here for the reason `refundQuote` is: the API refunds by it and the stay's page states it
 * before the button, so a copy on each side would promise one refund and give another.
 *
 * A stay ended early checks out tomorrow: tonight is used — the guest is in the place when
 * they press the button — and every night from tomorrow's on is given back at the policy's
 * `unusedNightsBps`. "Tonight" is the listing's: the day `now` falls on in its time zone
 * (`stayDay`), not the UTC one.
 */

const IN_UTC = { in: tz("UTC") };

/** The day after the listing's today: the check-out of a stay ended early at `now`. */
export function earlyCheckOut(
  stay: Pick<CheckIn, "timeZone">,
  now: Date,
): string {
  return format(
    addDays(parseISO(stayDay(stay, now), IN_UTC), 1, IN_UTC),
    "yyyy-MM-dd",
  );
}

/**
 * The body of `POST /bookings/:id/end-early`: the terms the stay's page stated — the
 * check-out and the refund. The API ends the stay only while that check-out is still
 * `earlyCheckOut` of its own day — a confirmation pressed after the listing's midnight would
 * otherwise end the stay a day later and refund a night less than the dialog said — and only
 * while the refund is not less than `refundCents`: a refund recorded since the page read the
 * stay (an admin's, the dashboard's) takes its part of the unused nights too. Either is a
 * `409` to read the terms again. A larger refund is no reason to refuse; it is `0` when the
 * page stated none.
 */
export const endStayEarlySchema = z.object({
  checkOut: z.iso.date({
    error: "Name the check-out the refund was stated for",
  }),
  refundCents: centsSchema,
});

export type EndStayEarlyInput = z.infer<typeof endStayEarlySchema>;

/**
 * Whether a stay can end early at `now`: confirmed, begun — the moment of check-in has come,
 * the very moment a cancellation is refused from, so there is never a time when both or
 * neither is offered — and with at least one night left after tonight. A stay ended early
 * already checks out tomorrow, so it has none left and is refused too.
 */
export function mayEndEarly(
  booking: Pick<Booking, "status" | "from" | "to" | "timeZone" | "checkInTime">,
  now: Date,
): boolean {
  return (
    booking.status === BookingStatus.CONFIRMED &&
    !isBefore(now, checkInInstant(booking)) &&
    earlyCheckOut(booking, now) < booking.to
  );
}

/**
 * What ending a stay early at `now` gives back, and the new check-out: the nights it no
 * longer uses (`booking_nights` from tomorrow's on, at the prices they were bought at), the
 * policy's share of them and that share in cents.
 */
export type UnusedNightsRefund = {
  checkOut: string;
  /** How many nights go unused — from the check-out on. */
  nights: number;
  shareBps: number;
  /**
   * The policy's share of what is left of the unused nights after earlier refunds, rounded
   * half up once, in the guest's favour.
   */
  cents: Cents;
  /**
   * Whether earlier refunds took their part of these nights, so `cents` is less than the
   * share of what they cost the guest. A rate's discount is part of that cost, not a
   * reduction.
   */
  reduced: boolean;
};

/**
 * The share is taken of the nights' own prices, so a weekend night left unused gives back
 * what it cost rather than an average. What the guest holds of them is what was paid and
 * not refunded, spread over every night of the stay alike by price: the unused ones keep
 * `notRefunded / Σ nights` of their worth. That one ratio covers both things that make the
 * payment less than the nights — a rate's discount, taken off the total rather than off any
 * night, and a refund sent earlier (an admin's, the dashboard's), which names no nights
 * either — so a discounted stay is given back what its nights cost at the discount, never
 * their full prices. The guest is not handed the night they used for free, and the earlier
 * refund is not taken back out of the nights they leave. Whether there is a payment at all
 * is the caller's to know, as it is for `refundQuote`.
 */
export function unusedNightsRefund(
  booking: Pick<
    Booking,
    "cancellationPolicy" | "amountCents" | "refundedAmountCents" | "timeZone"
  >,
  nights: readonly PricedNight[],
  now: Date,
): UnusedNightsRefund {
  const checkOut = earlyCheckOut(booking, now);
  const unused = nights.filter((night) => night.date >= checkOut);
  const shareBps =
    CANCELLATION_TERMS[booking.cancellationPolicy].unusedNightsBps;
  const worth = unused.reduce(
    (sum, night) => addCents(sum, night.priceCents),
    NO_CENTS,
  );
  const total = stayTotal(nights);
  const left = notRefunded(booking.amountCents, booking.refundedAmountCents);
  // Never past what is left — the unused nights are a part of the total, so only a set of
  // nights that is not the stay's could reach it.
  const refund = minCents(
    proportionalShare(worth, shareBps, left, total),
    left,
  );

  return {
    checkOut,
    nights: unused.length,
    shareBps,
    cents: refund,
    // Against the same share with nothing refunded yet, so a discount alone reduces nothing.
    reduced:
      refund < proportionalShare(worth, shareBps, booking.amountCents, total),
  };
}

/**
 * `bps` of `worth × held / total`, rounded half up once. In `bigint`, because the product
 * of three amounts and a rate passes `Number.MAX_SAFE_INTEGER` near `MAX_CHARGE`.
 */
function proportionalShare(
  worth: Cents,
  bps: number,
  held: Cents,
  total: Cents,
): Cents {
  if (total === NO_CENTS) return NO_CENTS;

  const numerator = BigInt(worth) * BigInt(bps) * BigInt(held);
  const denominator = BigInt(total) * BigInt(BASIS_POINTS);

  return cents(Number((2n * numerator + denominator) / (2n * denominator)));
}
