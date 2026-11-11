import {
  BookingRate,
  chargeRefusal,
  quoteStay,
  type PricedListing,
  type StayQuote,
} from "@repo/contracts";
import { isDay, nightsBetween } from "#shared/lib";

/**
 * The rate a stay would be booked at: the one chosen, while the listing still offers it
 * and the dates call for a hold. A `412` redraws the page with the terms now in force
 * while the form keeps its values, so a rate the host withdrew meanwhile stays chosen with
 * nothing left on the screen to change it; and dates the waitlist takes hide `RateChoice`
 * with the choice still made, though a wish books nothing at any rate. The quote, the
 * cancellation terms and the request all read it through here, so they fall back to the
 * standard rate together rather than the request alone being refused or the screen
 * quoting a discount nobody is taking.
 */
export function offeredRate(
  rate: BookingRate | undefined,
  discountBps: number | null,
  /** Whether the dates go on the waitlist rather than into a hold — `callsForWaitlist`. */
  waits: boolean,
): BookingRate {
  return rate === BookingRate.NON_REFUNDABLE && discountBps !== null && !waits
    ? BookingRate.NON_REFUNDABLE
    : BookingRate.STANDARD;
}

/** What the form calls each rate — the options of `RateChoice` and the quote's hint alike. */
export const RATE_TITLES: Record<BookingRate, string> = {
  [BookingRate.STANDARD]: "Standard",
  [BookingRate.NON_REFUNDABLE]: "Non-refundable",
};

/**
 * The longest stay the form quotes as the dates are typed. A year typed a digit at a time
 * passes through 0002 on its way to 2026, and a quote of every night between would be
 * thousands of entries on a keystroke; the API refuses nothing of the kind on its own, so
 * the bound is the screen's, and a stay longer than a year gets no quote rather than a slow
 * one. Nor does it get `chargeRefusal` before the press: only the ceiling can refuse that
 * many nights, the API alone bounds them, and its `422` lands under the form as the action's
 * message — once, since there is no quote line to repeat it.
 */
const QUOTED_NIGHTS = 366;

/** What the dates in the boxes cost at each rate the listing offers. */
export type StayRates = {
  standard: StayQuote;
  /** `null` for a listing that offers no non-refundable rate. */
  nonRefundable: StayQuote | null;
};

type StayRatesCall = {
  prices: PricedListing;
  discountBps: number | null;
  from: string;
  to: string;
  rates: StayRates | null;
};

/**
 * The last call and its answer. `StayQuote`, `RateChoice` and `BookingSubmit` each subscribe
 * to the dates on their own, so the form does not redraw on a keystroke, and each asks for
 * the same rates in the same render — up to a year of nights, twice. One entry is enough:
 * all three ask with the same arguments, and `prices` is the listing's object, the same
 * from render to render.
 */
let lastCall: StayRatesCall | null = null;

/**
 * Both rates for the dates typed, by `quoteStay` — the rule the hold is charged by — or
 * `null` while the boxes hold no stay worth quoting.
 */
export function stayRates(
  prices: PricedListing,
  discountBps: number | null,
  from: string,
  to: string,
): StayRates | null {
  if (
    lastCall !== null &&
    lastCall.prices === prices &&
    lastCall.discountBps === discountBps &&
    lastCall.from === from &&
    lastCall.to === to
  ) {
    return lastCall.rates;
  }

  const rates = quoteRates(prices, discountBps, from, to);

  lastCall = { prices, discountBps, from, to, rates };

  return rates;
}

function quoteRates(
  prices: PricedListing,
  discountBps: number | null,
  from: string,
  to: string,
): StayRates | null {
  const length = isDay(from) && isDay(to) ? nightsBetween(from, to) : 0;

  if (length <= 0 || length > QUOTED_NIGHTS) return null;

  return {
    standard: quoteStay(prices, from, to),
    nonRefundable:
      discountBps === null ? null : quoteStay(prices, from, to, discountBps),
  };
}

/** What the dates in the boxes would charge at the rate they would be booked at. */
export type StayCharge = {
  quote: StayQuote;
  /**
   * Why one payment cannot carry it (`chargeRefusal`), in the words the API would refuse the
   * hold with — `null` when it can, and for dates the waitlist takes, which charge nothing.
   */
  refusal: string | null;
  /**
   * The other rate, when the refused one is outside what one payment carries and the other
   * is inside it — fewer or more nights is then not the only way out. `null` when nothing is
   * refused, when the listing offers a single rate, or when neither fits.
   */
  instead: BookingRate | null;
};

/**
 * The quote of the rate a stay would be booked at (`offeredRate`) and whether one payment
 * can carry it. `StayQuote` states the refusal and `BookingSubmit` withholds the press it
 * would answer, so both read it here rather than working it out apart.
 */
export function stayCharge(
  rates: StayRates,
  offered: BookingRate,
  waits: boolean,
): StayCharge {
  const quote =
    (offered === BookingRate.NON_REFUNDABLE ? rates.nonRefundable : null) ??
    rates.standard;
  const refusal = waits ? null : chargeRefusal(quote.amountCents);

  return {
    quote,
    refusal,
    instead: refusal === null ? null : fittingRate(rates, offered),
  };
}

/** The rate other than `refused` when one payment can carry it — see `StayCharge.instead`. */
function fittingRate(
  rates: StayRates,
  refused: BookingRate,
): BookingRate | null {
  if (rates.nonRefundable === null) return null;

  const [other, quote] =
    refused === BookingRate.NON_REFUNDABLE
      ? [BookingRate.STANDARD, rates.standard]
      : [BookingRate.NON_REFUNDABLE, rates.nonRefundable];

  return chargeRefusal(quote.amountCents) === null ? other : null;
}
