"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { registerSchema } from "@repo/contracts";
import { authApi } from "#shared/api";
import { ROUTES } from "#shared/config";
import {
  toFieldErrors,
  toFormErrors,
  toLocalPath,
  type FormErrors,
} from "#shared/lib";

/**
 * The same shape as the login action, and the same reason for it. `registerSchema` is the
 * stricter of the two on purpose — the password policy applies to a password being chosen,
 * not to one being typed in again — and registration opens the session, so there is
 * nothing to sign in to afterwards.
 */
export async function registerAction(
  next: string,
  _state: FormErrors,
  formData: FormData,
): Promise<FormErrors> {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { message: null, fields: toFieldErrors(parsed.error.issues) };
  }

  try {
    await authApi.register(parsed.data);
  } catch (error) {
    return toFormErrors(error);
  }

  refresh();
  redirect(toLocalPath(next, ROUTES.profile));
}
