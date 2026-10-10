"use client";

import {
  createBookingSchema,
  pricedNights,
  stayTotal,
  type CreateBookingInput,
  type PricedListing,
  type PricedNight,
} from "@repo/contracts";
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
 * The price is worked out here as the dates change, night by night — a weekend or a date
 * priced on its own costs what the owner set for it (`nightlyPrice` in the contract, the
 * rule the payment of phase 6 charges by too). This number is what the guest is told, not
 * what they are charged. Nothing about it is sent: the API reads the prices off the
 * listing, which is why `createBookingSchema` has no amount on it at all.
 *
 * `createBookingSchema` is also what refuses a check-out before the check-in and a stay in
 * the past, here as well as in the action. `listingId` is one of its fields, so the form
 * is handed it as a bound value rather than as a box — it is what the schema needs to parse
 * at all, and the action ignores what arrives and uses the id the page bound to it.
 */
export const BookingForm = ({
  listingId,
  prices,
  earliest,
}: {
  listingId: string;
  /** The default price and the exceptions to it, off the listing being booked. */
  prices: PricedListing;
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

  const length = isDay(from) && isDay(to) ? nightsBetween(from, to) : 0;
  const nights =
    length > 0 && length <= QUOTED_NIGHTS ? pricedNights(prices, from, to) : [];

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

            {nights.length > 0 && (
              <p className="text-sm">
                {byPrice(nights)
                  .map(
                    ({ price, count }) =>
                      `${countOf(count, "night")} × ${formatMoney(price)}`,
                  )
                  .join(" + ")}{" "}
                ={" "}
                <span className="font-semibold">
                  {formatMoney(stayTotal(nights))}
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
