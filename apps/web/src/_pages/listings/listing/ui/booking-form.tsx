"use client";

import { useState } from "react";
import {
  createBookingSchema,
  type BookedRange,
  type CreateBookingInput,
  type PricedListing,
} from "@repo/contracts";
import {
  FieldDescription,
  FieldError,
  FieldGroup,
} from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { isDay, useActionForm } from "#shared/lib";
import { FormField } from "#shared/ui";
import { createBookingAction } from "../api/create-booking-action";
import { joinWaitlistAction } from "../api/join-waitlist-action";
import { callsForWaitlist } from "../lib/months";
import { BookingSubmit } from "./booking-submit";
import { StayQuote } from "./stay-quote";

/**
 * The form phase 4's locking transaction has been waiting for: this is the only thing on
 * this site that creates a booking, and until the payment step exists the hold it takes
 * lives out its fifteen minutes and lapses.
 *
 * The price is worked out beside the submit as the dates change (`StayQuote`), by the rule
 * the payment of phase 6 charges by too. Nothing about it is sent: the API reads the
 * prices off the listing, which is why `createBookingSchema` has no amount on it at all.
 *
 * `createBookingSchema` is also what refuses a check-out before the check-in and a stay in
 * the past, here as well as in the action. `listingId` is one of its fields, so the form
 * is handed it as a bound value rather than as a box — it is what the schema needs to parse
 * at all, and the action ignores what arrives and uses the id the page bound to it.
 *
 * Dates the calendar draws as taken are not refused here: the form offers the waitlist for
 * them instead of a hold, and submits to that action. Which of the two is decided off the
 * values being sent, so the button and the submit cannot disagree. The calendar is a
 * moment old, and both actions read it again on a `409` — the form then flips to whichever
 * of the two the nights now call for. The calendar covers a window, so a refused hold is
 * also remembered here: nights past the window would otherwise be offered as a hold again
 * and again, and never the waitlist.
 */
export const BookingForm = ({
  listingId,
  prices,
  earliest,
  booked,
}: {
  listingId: string;
  /** The default price and the exceptions to it, off the listing being booked. */
  prices: PricedListing;
  /** Today in UTC, from the server — see `shared/lib/dates.ts`. */
  earliest: string;
  /** The nights the calendar draws as taken — what decides between a hold and the waitlist. */
  booked: readonly BookedRange[];
}) => {
  const [refused, setRefused] = useState<BookedRange | null>(null);
  const { form, submit, pending, message } = useActionForm<CreateBookingInput>({
    action: async (state, values) => {
      const waits = callsForWaitlist(values.from, values.to, booked, refused);
      const answer = waits
        ? await joinWaitlistAction(listingId, state, values)
        : await createBookingAction(listingId, state, values);

      if (answer.stale) {
        setRefused(waits ? null : { from: values.from, to: values.to });
      }

      return answer;
    },
    schema: createBookingSchema,
    defaultValues: { from: "", to: "" },
    bound: { listingId },
  });

  // The check-out box starts where the check-in does, so the form redraws on this one date;
  // the quote watches both on its own.
  const from = form.watch("from");

  return (
    // `method` is what a page with no scripts falls back to — see `register-form.tsx`.
    // `noValidate` is the usual reason: the browser's own validation would preempt the
    // contract with messages of its own.
    <form method="post" onSubmit={submit} noValidate>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField form={form} name="from" label="Check in">
            {(control) => (
              <Input
                {...control}
                type="date"
                size="lg"
                min={earliest}
                disabled={pending}
              />
            )}
          </FormField>

          <FormField
            form={form}
            name="to"
            label="Check out"
            description="Check-out is not a night: a stay from the 2nd to the 5th is three of them."
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                size="lg"
                min={isDay(from) ? from : earliest}
                disabled={pending}
              />
            )}
          </FormField>

          <div className="flex flex-col gap-4 lg:pt-6.5">
            <BookingSubmit
              control={form.control}
              booked={booked}
              refused={refused}
              pending={pending}
            />

            <StayQuote control={form.control} prices={prices} />
          </div>
        </div>

        {message !== null && <FieldError>{message}</FieldError>}

        <FieldDescription>
          A hold keeps the nights for fifteen minutes. There is nothing to pay
          with yet, so it lapses on its own and the nights go back on offer.
          Nights somebody else holds can be waited for instead: you are told
          when they come free, and the first to book takes them.
        </FieldDescription>
      </FieldGroup>
    </form>
  );
};
