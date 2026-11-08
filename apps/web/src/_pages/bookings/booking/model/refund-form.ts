import { z } from "zod";
import { adminRefundSchema, type AdminRefundInput } from "@repo/contracts";
import { centsFromInput, type FormErrors } from "#shared/lib";

/**
 * What the refund action answers: the refusal, and whether this answer leaves it unknown if
 * the refund went out — a `5xx`, an API that did not answer. A `4xx` is the API answering
 * this press in its own words, which is not always "nothing was sent": a `409` for a stay
 * another request holds — the first press, still running past the dialog's ten seconds — or
 * for a claim too young to let go says nothing about a claim an earlier press left. So the
 * dialog, once an answer was uncertain, holds the amount and the reason as they were until
 * it closes: pressing again is the same request, and the claim refuses another amount anyway.
 */
export type RefundErrors = FormErrors & { uncertain: boolean };

/**
 * What the refund dialog's boxes hold: the amount as typed in the currency — `50.00` — under
 * the contract's name, for the reason `ListingFormValues` gives, and the reason. The request's
 * id is no box: the dialog mints it and the form carries it as `bound`.
 */
export type RefundFormValues = {
  amountCents: string;
  reason: string;
  requestId: string;
};

/**
 * The amount through `centsFromInput`, then `adminRefundSchema` — which refuses and words
 * every rule. What is left of the stay is the API's to refuse: the dialog states it, and the
 * webhook a moment ago may have lowered it.
 */
export const refundFormSchema = z
  .object({
    amountCents: z.string().catch(""),
    reason: z.custom<string>(),
    requestId: z.custom<string>(),
  })
  .transform((values): unknown => ({
    ...values,
    amountCents: centsFromInput(values.amountCents),
  }))
  .pipe(adminRefundSchema) satisfies z.ZodType<
  AdminRefundInput,
  RefundFormValues
>;
