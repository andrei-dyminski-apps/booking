"use server";

import {
  requestEmailChangeSchema,
  type RequestEmailChangeInput,
} from "@repo/contracts";
import { authApi } from "#shared/api";
import { toFieldErrors, toFormErrors, type FormErrors } from "#shared/lib";

export async function requestEmailChangeAction(
  values: RequestEmailChangeInput,
): Promise<FormErrors | null> {
  const parsed = requestEmailChangeSchema.safeParse(values);
  if (!parsed.success)
    return { message: null, fields: toFieldErrors(parsed.error.issues) };
  try {
    await authApi.requestEmailChange(parsed.data);
    return null;
  } catch (error) {
    return toFormErrors(error);
  }
}
