"use client";

import { useWatch, type Control } from "react-hook-form";
import type {
  BookedRange,
  CreateBookingInput,
  PricedListing,
} from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { isDay } from "#shared/lib";
import { callsForWaitlist } from "../lib/months";
import { offeredRate, stayCharge, stayRates } from "../lib/stay-rates";

/**
 * The booking form's submit, worded by what it will do with the dates in the boxes: hold
 * them, or wait for them when the calendar draws some of their nights as taken. A hold one
 * payment could not carry at the rate it would be booked at (`stayCharge`) is not offered:
 * `StayQuote` says why beside it, and the press would only bring the same words back as a
 * `422`. It subscribes to the dates and the rate in a component of its own, for the reason
 * `StayQuote` does — a change of date redraws the button rather than the whole form.
 */
export const BookingSubmit = ({
  control,
  prices,
  discountBps,
  booked,
  refused,
  pending,
}: {
  control: Control<CreateBookingInput>;
  /** The default price and the exceptions to it, off the listing being booked. */
  prices: PricedListing;
  /** The listing's non-refundable discount, or `null` when it offers no such rate. */
  discountBps: number | null;
  booked: readonly BookedRange[];
  /** The nights a hold was last refused for — see `BookingForm`. */
  refused: BookedRange | null;
  pending: boolean;
}) => {
  const [from, to, rate] = useWatch({ control, name: ["from", "to", "rate"] });
  const taken =
    isDay(from) && isDay(to) && callsForWaitlist(from, to, booked, refused);
  const rates = stayRates(prices, discountBps, from, to);
  const unchargeable =
    rates !== null &&
    stayCharge(rates, offeredRate(rate, discountBps, taken), taken).refusal !==
      null;

  return (
    <Button
      type="submit"
      size="lg"
      variant={taken ? "secondary" : "default"}
      loading={pending}
      // `loading` disables the button only when `disabled` is left out, so both are here.
      disabled={pending || unchargeable}
    >
      {taken ? "Notify me when free" : "Hold these dates"}
    </Button>
  );
};
