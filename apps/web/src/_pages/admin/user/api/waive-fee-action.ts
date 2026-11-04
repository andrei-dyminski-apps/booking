"use server";

import { refresh } from "next/cache";
import { waiveHostFeeSchema, type WaiveHostFeeInput } from "@repo/contracts";
import { hostFeesApi } from "#shared/api";
import {
  NO_FORM_ERRORS,
  toFieldErrors,
  toFormErrors,
  type FormErrors,
} from "#shared/lib";

/**
 * Waiving a host's fee: the circumstance a policy could not foresee. The fee is bound by
 * the button; the reason is parsed again here with the schema the API validates the body
 * with, because the action is an endpoint of its own.
 */
export async function waiveFeeAction(
  feeId: string,
  _state: FormErrors,
  values: WaiveHostFeeInput,
): Promise<FormErrors> {
  const parsed = waiveHostFeeSchema.safeParse(values);

  if (!parsed.success) {
    return { message: null, fields: toFieldErrors(parsed.error.issues) };
  }

  try {
    await hostFeesApi.waive(feeId, parsed.data);
  } catch (error) {
    // A 409 for a fee another admin waived first or a payout withheld in full meanwhile,
    // a 404 for one that has gone, an unreachable API.
    return toFormErrors(error);
  }

  refresh();

  return NO_FORM_ERRORS;
}
