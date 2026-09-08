"use client";

import { createBookingSchema, type CreateBookingInput } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import {
  FieldDescription,
  FieldError,
  FieldGroup,
} from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import {
  countOf,
  formatMoney,
  isDay,
  nightsBetween,
  useActionForm,
} from "#shared/lib";
import { FormField } from "#shared/ui";
import { createBookingAction } from "../api/create-booking-action";

/**
 * The form phase 4's locking transaction has been waiting for: this is the only thing on
 * this site that creates a booking, and until the payment step exists the hold it takes
 * lives out its fifteen minutes and lapses.
 *
 * The price is worked out here as the dates change, and it is worked out again by the
 * server when there is something to pay for — this number is what the guest is told, not
 * what they are charged. Nothing about it is sent: the API reads the nightly price off the
 * listing, which is why `createBookingSchema` has no amount on it at all.
 *
 * `createBookingSchema` is also what refuses a check-out before the check-in and a stay in
 * the past, here as well as in the action. `listingId` is one of its fields, so the form
 * is handed it as a bound value rather than as a box — it is what the schema needs to parse
 * at all, and the action ignores what arrives and uses the id the page bound to it.
 */
export const BookingForm = ({
  listingId,
  pricePerNight,
  earliest,
}: {
  listingId: string;
  pricePerNight: number;
  /** Today in UTC, from the server — see `shared/lib/dates.ts`. */
  earliest: string;
}) => {
  const { form, submit, pending, message } = useActionForm<CreateBookingInput>({
    action: createBookingAction.bind(null, listingId),
    schema: createBookingSchema,
    defaultValues: { from: "", to: "" },
    bound: { listingId },
  });

  const from = form.watch("from");
  const to = form.watch("to");

  const nights = isDay(from) && isDay(to) ? nightsBetween(from, to) : 0;

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
            <Button type="submit" size="lg" loading={pending}>
              Hold these dates
            </Button>

            {nights > 0 && (
              <p className="text-sm">
                {countOf(nights, "night")} × {formatMoney(pricePerNight)} ={" "}
                <span className="font-semibold">
                  {formatMoney(nights * pricePerNight)}
                </span>
              </p>
            )}
          </div>
        </div>

        {message !== null && <FieldError>{message}</FieldError>}

        <FieldDescription>
          A hold keeps the nights for fifteen minutes. There is nothing to pay
          with yet, so it lapses on its own and the nights go back on offer.
        </FieldDescription>
      </FieldGroup>
    </form>
  );
};
