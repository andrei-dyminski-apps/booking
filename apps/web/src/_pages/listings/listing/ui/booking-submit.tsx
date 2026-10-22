"use client";

import { useWatch, type Control } from "react-hook-form";
import type { BookedRange, CreateBookingInput } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { isDay } from "#shared/lib";
import { callsForWaitlist } from "../lib/months";

/**
 * The booking form's submit, worded by what it will do with the dates in the boxes: hold
 * them, or wait for them when the calendar draws some of their nights as taken. It
 * subscribes to both dates in a component of its own, for the reason `StayQuote` does —
 * a change of date redraws the button rather than the whole form.
 */
export const BookingSubmit = ({
  control,
  booked,
  refused,
  pending,
}: {
  control: Control<CreateBookingInput>;
  booked: readonly BookedRange[];
  /** The nights a hold was last refused for — see `BookingForm`. */
  refused: BookedRange | null;
  pending: boolean;
}) => {
  const [from, to] = useWatch({ control, name: ["from", "to"] });
  const taken =
    isDay(from) && isDay(to) && callsForWaitlist(from, to, booked, refused);

  return (
    <Button
      type="submit"
      size="lg"
      variant={taken ? "secondary" : "default"}
      loading={pending}
    >
      {taken ? "Notify me when free" : "Hold these dates"}
    </Button>
  );
};
