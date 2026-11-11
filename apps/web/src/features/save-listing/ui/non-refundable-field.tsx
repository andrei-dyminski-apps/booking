"use client";

import { useController, useWatch, type UseFormReturn } from "react-hook-form";
import {
  CancellationPolicy,
  MAX_NON_REFUNDABLE_DISCOUNT_BPS,
  MIN_NON_REFUNDABLE_DISCOUNT_BPS,
  type CreateListingInput,
} from "@repo/contracts";
import { Field, FieldLabel } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { Switch } from "@repo/ui/components/switch";
import { FormField } from "#shared/ui";
import {
  percentOfBps,
  type ListingFormValues,
} from "../model/listing-form-schema";

const SWITCH_ID = "field-offersNonRefundable";

/**
 * The listing's non-refundable rate: a switch that offers it, and the discount it gives
 * once it is on. The switch is a controller for the reason the policy is — the design
 * system's `Switch` is not a native box a ref can read. The percentage is a plain box,
 * drawn only while the switch is on; the schema reads it only then, so a value typed and
 * switched off again is never sent.
 *
 * Under the `NON_REFUNDABLE` policy the rate is not on offer at all — the standard rate
 * already refunds nothing — so the switch is drawn off and disabled, with the reason in its
 * label, rather than left to meet `RATE_UNDER_NON_REFUNDABLE_POLICY` on submit. Its value
 * is kept, not cleared: the schema sends no rate under that policy, and picking another one
 * brings the switch and the percentage typed back as they were.
 */
export const NonRefundableField = ({
  form,
  pending,
}: {
  form: UseFormReturn<ListingFormValues, unknown, CreateListingInput>;
  pending: boolean;
}) => {
  const { field } = useController({
    control: form.control,
    name: "offersNonRefundable",
  });
  const policy = useWatch({
    control: form.control,
    name: "cancellationPolicy",
  });
  const unavailable = policy === CancellationPolicy.NON_REFUNDABLE;
  const offered = field.value && !unavailable;

  return (
    <div className="flex flex-col gap-4">
      <Field orientation="horizontal">
        <Switch
          id={SWITCH_ID}
          ref={field.ref}
          checked={offered}
          onCheckedChange={field.onChange}
          onBlur={field.onBlur}
          disabled={pending || unavailable}
        />
        <FieldLabel htmlFor={SWITCH_ID} className="flex-wrap">
          Offer a non-refundable rate
          {unavailable && (
            <span className="font-normal text-muted-foreground">
              (not beside the non-refundable policy, which already refunds
              nothing)
            </span>
          )}
        </FieldLabel>
      </Field>

      {offered && (
        <FormField
          form={form}
          name="nonRefundableDiscountBps"
          label="Non-refundable discount, %"
          description="What a guest who gives up every refund is given off the stay. A stay booked at this rate refunds the guest nothing if they cancel, whatever your cancellation policy; if you cancel, they are refunded in full."
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              size="lg"
              inputMode="decimal"
              step="0.01"
              min={percentOfBps(MIN_NON_REFUNDABLE_DISCOUNT_BPS)}
              max={percentOfBps(MAX_NON_REFUNDABLE_DISCOUNT_BPS)}
              disabled={pending}
            />
          )}
        </FormField>
      )}
    </div>
  );
};
