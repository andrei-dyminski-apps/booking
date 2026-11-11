"use client";

import { useId } from "react";
import {
  useController,
  useWatch,
  type Control,
  type RefCallBack,
} from "react-hook-form";
import {
  BookingRate,
  bookingRateSchema,
  chargeRefusal,
  type BookedRange,
  type CreateBookingInput,
  type PricedListing,
  type StayQuote,
} from "@repo/contracts";
import { Field, FieldContent, FieldLabel } from "@repo/ui/components/field";
import { RadioGroup, RadioGroupItem } from "@repo/ui/components/radio-group";
import { sharePercent } from "#entities/booking";
import { formatMoney, isDay } from "#shared/lib";
import { callsForWaitlist } from "../lib/months";
import { RATE_TITLES, stayRates } from "../lib/stay-rates";

/**
 * The two rates of a listing that offers a non-refundable one, each with what the dates in
 * the boxes come to at it — the totals by `quoteStay`, the rule the hold is charged by. A
 * controller rather than `register`: the design system's radios are Base UI's, not native
 * inputs a ref can read, so the ref goes to the chosen radio — the one a refusal focuses.
 * Nothing is drawn for a listing with a single rate, nor for dates the form would put on the
 * waitlist rather than hold: a wish books nothing, so there is no rate to choose for it.
 *
 * A rate whose total one payment cannot carry (`chargeRefusal` — the discount can take a
 * stay at the floor below it) is disabled and says why under its terms, in the API's own
 * words — unless it is the one chosen. One chosen before the dates moved it out of bounds
 * stays chosen and enabled until another is picked, with no reason of its own: `StayQuote`
 * says why the hold would be refused and `BookingSubmit` withholds the press. Disabling it
 * would take the group out of the tab order: Base UI keeps the roving tab stop on the
 * checked radio, and a disabled one is `tabIndex={-1}`.
 */
export const RateChoice = ({
  control,
  prices,
  discountBps,
  booked,
  refused,
}: {
  control: Control<CreateBookingInput>;
  prices: PricedListing;
  discountBps: number;
  booked: readonly BookedRange[];
  /** The nights a hold was last refused for — see `BookingForm`. */
  refused: BookedRange | null;
}) => {
  // Derived rather than written down, so nothing else on the page can share them.
  const id = useId();
  const { field } = useController({ control, name: "rate" });
  const [from, to] = useWatch({ control, name: ["from", "to"] });

  if (isDay(from) && isDay(to) && callsForWaitlist(from, to, booked, refused)) {
    return null;
  }

  const rates = stayRates(prices, discountBps, from, to);
  const chosen = field.value ?? BookingRate.STANDARD;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium" id={`${id}-label`}>
        Rate
      </h3>
      <RadioGroup
        aria-labelledby={`${id}-label`}
        value={chosen}
        onValueChange={(value) => {
          const rate = bookingRateSchema.safeParse(value);

          if (rate.success) field.onChange(rate.data);
        }}
        className="sm:grid-cols-2"
      >
        <RateOption
          id={`${id}-${BookingRate.STANDARD}`}
          value={BookingRate.STANDARD}
          title={RATE_TITLES[BookingRate.STANDARD]}
          note="Refunded under the listing's cancellation policy below."
          quote={rates?.standard ?? null}
          chosen={chosen === BookingRate.STANDARD}
          focusRef={chosen === BookingRate.STANDARD ? field.ref : undefined}
        />
        <RateOption
          id={`${id}-${BookingRate.NON_REFUNDABLE}`}
          value={BookingRate.NON_REFUNDABLE}
          title={`${RATE_TITLES[BookingRate.NON_REFUNDABLE]}, ${sharePercent(discountBps)} off`}
          note="Cancelling refunds nothing. If the host cancels, you are refunded in full."
          quote={rates?.nonRefundable ?? null}
          chosen={chosen === BookingRate.NON_REFUNDABLE}
          focusRef={
            chosen === BookingRate.NON_REFUNDABLE ? field.ref : undefined
          }
        />
      </RadioGroup>
    </div>
  );
};

const RateOption = ({
  id,
  value,
  title,
  note,
  quote,
  chosen,
  focusRef,
}: {
  id: string;
  value: string;
  title: string;
  note: string;
  quote: StayQuote | null;
  chosen: boolean;
  /** The form's ref, on the radio that is chosen. */
  focusRef: RefCallBack | undefined;
}) => {
  // The chosen rate is never disabled, and its refusal is `StayQuote`'s to state: written
  // here as well, it would be read twice — once beside the radio, once in the live region.
  const refusal =
    quote === null || chosen ? null : chargeRefusal(quote.amountCents);
  const disabled = refusal !== null;

  return (
    <Field
      orientation="horizontal"
      // `Field` dims its label on this attribute; the radio dims itself on its own.
      data-disabled={disabled}
      className="items-start rounded-lg border p-3"
    >
      <RadioGroupItem
        id={id}
        ref={focusRef}
        value={value}
        disabled={disabled}
        aria-describedby={disabled ? `${id}-refusal` : undefined}
        className="mt-0.5"
      />
      <FieldContent>
        <FieldLabel htmlFor={id} className="flex flex-col items-start gap-0.5">
          <span>
            {title}
            {quote !== null && (
              <>
                {" — "}
                <span className="font-semibold">
                  {formatMoney(quote.amountCents)}
                </span>
              </>
            )}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {note}
          </span>
        </FieldLabel>
        {refusal !== null && (
          // Beside the label rather than in it: `Field` dims the label of a disabled option,
          // and the reason is the one line of it that has to be read.
          <p id={`${id}-refusal`} className="text-xs text-destructive">
            {refusal}
          </p>
        )}
      </FieldContent>
    </Field>
  );
};
