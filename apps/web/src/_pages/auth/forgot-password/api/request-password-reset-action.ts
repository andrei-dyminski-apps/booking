"use server";

import { requestPasswordResetSchema } from "@repo/contracts";
import { authApi } from "#shared/api";
import { toFieldErrors, toFormErrors, type FormErrors } from "#shared/lib";

export async function requestPasswordResetAction(
  email: string,
): Promise<FormErrors | null> {
  const parsed = requestPasswordResetSchema.safeParse({ email });
  if (!parsed.success)
    return { message: null, fields: toFieldErrors(parsed.error.issues) };
  try {
    await authApi.requestPasswordReset(parsed.data.email);
    return null;
  } catch (error) {
    return toFormErrors(error);
  }
}
