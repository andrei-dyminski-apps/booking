"use client";

import { useWatch, type Control } from "react-hook-form";
import type {
  BookedRange,
  CreateBookingInput,
  PricedListing,
} from "@repo/contracts";
import { formatMoney, nightsBreakdown } from "#shared/lib";
import { callsForWaitlist } from "../lib/months";
import {
  offeredRate,
  RATE_TITLES,
  stayCharge,
  stayRates,
} from "../lib/stay-rates";

/**
 * What the dates in the booking form cost, night by night — a weekend or a date priced on
 * its own costs what the owner set for it (`nightlyPrice` in the contract) — less the
 * discount when the non-refundable rate is chosen and the dates call for a hold. This
 * number is what the guest is told, not what they are charged: nothing about it is sent.
 * A total one payment cannot carry is followed by the reason the API would refuse the hold
 * with (`stayCharge`), so the guest reads it before the press rather than after it — and by
 * the other rate when that one fits, since switching rates is a way out too. The press
 * itself is withheld meanwhile (`BookingSubmit`), so the reason is never answered a second
 * time under the form. Dates the waitlist takes charge nothing, and get no such line.
 *
 * It subscribes to the dates and the rate in a component of its own, so a keystroke in a
 * date box redraws this line rather than the whole form.
 */
export const StayQuote = ({
  control,
  prices,
  discountBps,
  booked,
  refused,
}: {
  control: Control<CreateBookingInput>;
  /** The default price and the exceptions to it, off the listing being booked. */
  prices: PricedListing;
  /** The listing's non-refundable discount, or `null` when it offers no such rate. */
  discountBps: number | null;
  booked: readonly BookedRange[];
  /** The nights a hold was last refused for — see `BookingForm`. */
  refused: BookedRange | null;
}) => {
  const [from, to, rate] = useWatch({ control, name: ["from", "to", "rate"] });
  const rates = stayRates(prices, discountBps, from, to);

  if (rates === null) return null;

  // `stayRates` quotes only two days that parse, so the dates can be compared as they are.
  const waits = callsForWaitlist(from, to, booked, refused);
  const { quote, refusal, instead } = stayCharge(
    rates,
    offeredRate(rate, discountBps, waits),
    waits,
  );

  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>
        {nightsBreakdown(quote.nights)}
        {quote.discountCents > 0 && (
          <> − {formatMoney(quote.discountCents)} non-refundable discount</>
        )}{" "}
        ={" "}
        <span className="font-semibold">{formatMoney(quote.amountCents)}</span>
      </p>
      {/* Mounted always, so a live region exists before the refusal lands in it: the submit
          is disabled meanwhile and drops out of the tab order, and this is what says why. */}
      <div aria-live="polite" className="text-destructive empty:hidden">
        {refusal !== null && <p>{refusal}</p>}
        {/* A sentence of its own rather than a tail on the contract's words, which would
            break the day those are reworded. */}
        {instead !== null && (
          <p>One payment can carry it at the {RATE_TITLES[instead]} rate.</p>
        )}
      </div>
    </div>
  );
};
