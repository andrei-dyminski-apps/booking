"use client";

import type { UseFormReturn } from "react-hook-form";
import {
  Canceller,
  MAX_CANCELLATION_REASON_LENGTH,
  type CancelBookingInput,
} from "@repo/contracts";
import { Textarea } from "@repo/ui/components/textarea";
import { FormField } from "#shared/ui";
import type { CancelFormValues } from "../model/cancel-form";

/** Who reads the reason, told to whoever writes it. */
const READERS: Record<Canceller, string> = {
  [Canceller.GUEST]: "The host reads it with the cancellation.",
  [Canceller.HOST]: "The guest reads it with the cancellation.",
  [Canceller.ADMIN]: "The guest and the host read it with the cancellation.",
};

/**
 * Why the stay is cancelled. The host has to say — the guest is told, and an admin reads
 * it beside the host's fees — while the guest and an admin may leave it blank.
 */
export const CancelReasonField = ({
  form,
  canceller,
  declining,
  pending,
}: {
  form: UseFormReturn<CancelFormValues, unknown, CancelBookingInput>;
  canceller: Canceller;
  /** The host turning down a hold nobody has paid for. */
  declining: boolean;
  pending: boolean;
}) => (
  <FormField
    form={form}
    name="reason"
    label={
      canceller !== Canceller.HOST
        ? "Reason (optional)"
        : declining
          ? "Why are you declining?"
          : "Why are you cancelling?"
    }
    description={READERS[canceller]}
    limit={MAX_CANCELLATION_REASON_LENGTH}
  >
    {(control) => <Textarea {...control} rows={3} disabled={pending} />}
  </FormField>
);
