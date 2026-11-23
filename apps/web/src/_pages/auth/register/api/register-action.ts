"use server";

import { registerSchema, type RegisterInput } from "@repo/contracts";
import { authApi } from "#shared/api";
import { ROUTES } from "#shared/config";
import {
  toFormErrors,
  toFieldErrors,
  toLocalPath,
  type FormErrors,
} from "#shared/lib";

export async function registerAction(
  values: RegisterInput,
): Promise<FormErrors | null> {
  const parsed = registerSchema.safeParse(values);
  if (!parsed.success)
    return { message: null, fields: toFieldErrors(parsed.error.issues) };

  try {
    await authApi.register({
      email: parsed.data.email,
      next: toLocalPath(parsed.data.next, ROUTES.profile),
    });
    return null;
  } catch (error) {
    return toFormErrors(error);
  }
}
