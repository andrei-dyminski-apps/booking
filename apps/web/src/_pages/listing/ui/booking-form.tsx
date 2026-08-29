"use client";

import { useActionState, useState } from "react";
import { Button } from "@repo/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import {
  fieldMessages,
  formatMoney,
  isDay,
  nightsBetween,
  NO_FORM_ERRORS,
  type FormErrors,
} from "#shared/lib";
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
  const [errors, submit, pending] = useActionState<FormErrors, FormData>(
    createBookingAction.bind(null, listingId),
    NO_FORM_ERRORS,
  );
  // Controlled, like every other form here: React resets an uncontrolled one once an
  // action settles, which would clear both dates at the moment the message explaining
  // what was wrong with them appears.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const nights = isDay(from) && isDay(to) ? nightsBetween(from, to) : 0;

  return (
    // The browser's own validation would preempt the contract with messages of its own.
    <form action={submit} noValidate>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field data-invalid={errors.fields.from !== undefined}>
            <FieldLabel htmlFor="from">Check in</FieldLabel>
            <Input
              id="from"
              name="from"
              type="date"
              size="lg"
              min={earliest}
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
              }}
              aria-invalid={errors.fields.from !== undefined}
              disabled={pending}
            />
            <FieldError errors={fieldMessages(errors.fields.from)} />
          </Field>

          <Field data-invalid={errors.fields.to !== undefined}>
            <FieldLabel htmlFor="to">Check out</FieldLabel>
            <Input
              id="to"
              name="to"
              type="date"
              size="lg"
              min={from === "" ? earliest : from}
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
              }}
              aria-invalid={errors.fields.to !== undefined}
              disabled={pending}
            />
            <FieldDescription>
              Check-out is not a night: a stay from the 2nd to the 5th is three
              of them.
            </FieldDescription>
            <FieldError errors={fieldMessages(errors.fields.to)} />
          </Field>

          <div className="flex flex-col gap-4 lg:pt-6.5">
            <Button type="submit" size="lg" loading={pending}>
              Hold these dates
            </Button>

            {nights > 0 && (
              <p className="text-sm">
                {nights} {nights === 1 ? "night" : "nights"} ×{" "}
                {formatMoney(pricePerNight)} ={" "}
                <span className="font-semibold">
                  {formatMoney(nights * pricePerNight)}
                </span>
              </p>
            )}
          </div>
        </div>

        {errors.message !== null && <FieldError>{errors.message}</FieldError>}

        <FieldDescription>
          A hold keeps the nights for fifteen minutes. There is nothing to pay
          with yet, so it lapses on its own and the nights go back on offer.
        </FieldDescription>
      </FieldGroup>
    </form>
  );
};
