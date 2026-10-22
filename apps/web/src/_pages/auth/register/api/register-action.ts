"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { registerSchema, type RegisterInput } from "@repo/contracts";
import { authApi } from "#shared/api";
import { ROUTES } from "#shared/config";
import {
  toFieldErrors,
  toFormErrors,
  toLocalPath,
  type FormErrors,
} from "#shared/lib";

/**
 * `registerSchema` is the stricter of the two session schemas on purpose — the password
 * policy applies to a password being chosen, not to one being typed in again — and
 * registration opens the session, so there is nothing to sign in to afterwards.
 *
 * The form has already validated against this very schema, and the parse below is not a
 * repetition of it: an action is an endpoint of its own, reachable by anything that can
 * spell its id, so what the type of `values` says the browser sent is a claim and this is
 * where it is checked.
 */
export async function registerAction(
  next: string,
  _state: FormErrors,
  values: RegisterInput,
): Promise<FormErrors> {
  const parsed = registerSchema.safeParse(values);

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
