"use client";

import { useController, type UseFormReturn } from "react-hook-form";
import type { CreateListingInput } from "@repo/contracts";
import { Field, FieldError } from "@repo/ui/components/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import {
  CANCELLATION_POLICY_LABELS,
  cancellationPolicyOptions,
  policySummary,
} from "#entities/booking";
import { fieldMessages, messagesOf } from "#shared/lib";
import { HintLabel, hintOf } from "#shared/ui";
import type { ListingFormValues } from "../model/listing-form-schema";

const ID = "field-cancellationPolicy";

/**
 * The listing's cancellation policy, picked out of the five. A controller rather than
 * `FormField`'s `register`: the design system's `Select` is a listbox, not a native box a
 * ref can read, so the value goes into the form through `onValueChange`. Each option
 * carries its one-line summary, and the hint says the part a host has to know before
 * changing it — a stay already booked keeps the policy it was booked under.
 */
export const PolicyField = ({
  form,
  pending,
}: {
  form: UseFormReturn<ListingFormValues, unknown, CreateListingInput>;
  pending: boolean;
}) => {
  const { field, fieldState } = useController({
    control: form.control,
    name: "cancellationPolicy",
  });
  const messages = messagesOf(fieldState.error);
  const hint = hintOf(
    ID,
    "What a guest's cancellation refunds, and until when. A stay keeps the policy it was booked under, whatever this says later.",
  );
  const errorId = messages === undefined ? undefined : `${ID}-error`;

  return (
    <Field data-invalid={fieldState.invalid}>
      <HintLabel htmlFor={ID} label="Cancellation policy" hint={hint} />
      <Select
        value={field.value}
        onValueChange={(value) => {
          if (value !== null) field.onChange(value);
        }}
        items={CANCELLATION_POLICY_LABELS}
        disabled={pending}
      >
        <SelectTrigger
          id={ID}
          ref={field.ref}
          onBlur={field.onBlur}
          aria-invalid={fieldState.invalid}
          aria-describedby={
            [hint?.id, errorId].filter(Boolean).join(" ") || undefined
          }
          className="h-10 w-full min-w-0 text-base md:text-sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {cancellationPolicyOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex flex-col gap-0.5">
                <span>{option.label}</span>
                <span className="text-xs text-muted-foreground">
                  {policySummary(option.value)}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError id={errorId} errors={fieldMessages(messages)} />
    </Field>
  );
};
