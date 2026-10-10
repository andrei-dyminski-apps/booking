"use client";

import { XIcon } from "lucide-react";
import {
  useFieldArray,
  useFormState,
  type UseFormReturn,
} from "react-hook-form";
import { weekdaySchema, type CreateListingInput } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { FieldError } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { fieldMessages, messagesOf, WEEKDAY_NAMES } from "#shared/lib";
import { FormField, HintFieldSet } from "#shared/ui";
import { toNumber } from "../lib/to-number";

/**
 * The exceptions to the default price, as two groups of boxes inside the listing form: a
 * price per day of the week, and a list of single dates. Which of the three a night costs
 * is the contract's rule (`nightlyPrice`) — the date first, then the weekday, then the
 * default — and the descriptions here only say it in words.
 *
 * Every price box steps in cents for the reason the default price's box does.
 */
export const PricingFields = ({
  form,
  pending,
  earliest,
}: {
  form: UseFormReturn<CreateListingInput>;
  pending: boolean;
  /** Today in UTC, from the server: the first day a date price may be set for. */
  earliest: string;
}) => {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "pricing.dates",
  });
  const { errors } = useFormState({ control: form.control, name: "pricing" });

  // A refusal of a group rather than of a box: two prices for one date and too many dates
  // are the browser's, under `root`; whatever the API refuses below `pricing` arrives keyed
  // by the first segment of its path and lands on the group itself.
  const groupMessages = [
    ...(messagesOf(errors.pricing?.dates?.root) ?? []),
    ...(messagesOf(errors.pricing?.dates) ?? []),
    ...(messagesOf(errors.pricing) ?? []),
  ];

  return (
    <>
      <HintFieldSet
        id="pricing-weekdays"
        label="Price by day of the week"
        description="Every night that falls on the day costs this instead of the default. Leave a day empty to charge the default."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {weekdaySchema.options.map((weekday) => (
            <FormField
              key={weekday}
              form={form}
              name={`pricing.weekdays.${weekday}`}
              label={WEEKDAY_NAMES[weekday]}
              options={{ setValueAs: toNumber }}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  disabled={pending}
                />
              )}
            </FormField>
          ))}
        </div>
      </HintFieldSet>

      <HintFieldSet
        id="pricing-dates"
        label="Price for specific dates"
        description="The night that starts on the date costs this, whatever day of the week it is — a holiday, a festival, a quiet week."
      >
        {fields.length > 0 && (
          <ul role="list" className="flex flex-col gap-4">
            {fields.map((field, index) => (
              // `field.id` rather than the index: removing a row above would otherwise
              // hand this one the values of the row that took its place.
              <li
                key={field.id}
                className="grid grid-cols-[1fr_1fr_auto] items-start gap-3"
              >
                <FormField
                  form={form}
                  name={`pricing.dates.${index}.date`}
                  label="Date"
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="date"
                      min={earliest}
                      disabled={pending}
                    />
                  )}
                </FormField>

                <FormField
                  form={form}
                  name={`pricing.dates.${index}.price`}
                  label="Price"
                  options={{ setValueAs: toNumber }}
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0.01"
                      disabled={pending}
                    />
                  )}
                </FormField>

                {/* Level with the boxes rather than with their labels. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-7"
                  aria-label={`Remove date price ${String(index + 1)}`}
                  disabled={pending}
                  // The form validates on blur, and a press takes focus off the box before
                  // the click removes its row: an empty date would flash its refusal for
                  // the moment in between. Keeping focus where it is skips that blur.
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    remove(index);
                  }}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <FieldError errors={fieldMessages(groupMessages)} />

        <div>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              // The new row starts at the default price, which is what the night costs
              // until it is changed — an empty box would be a refusal waiting to happen.
              append(
                { date: "", price: form.getValues("pricePerNight") },
                { shouldFocus: true },
              );
            }}
          >
            Add a date
          </Button>
        </div>
      </HintFieldSet>
    </>
  );
};
