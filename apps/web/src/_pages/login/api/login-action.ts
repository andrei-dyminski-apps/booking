"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { loginSchema } from "@repo/contracts";
import { authApi } from "#shared/api";
import { ROUTES } from "#shared/config";
import {
  toFieldErrors,
  toFormErrors,
  toLocalPath,
  type FormErrors,
} from "#shared/lib";

/**
 * Signing in is a mutation of the session, so it happens on the server: the answer of the
 * API carries the pair as cookies for its own host, and only this side can re-issue them
 * for this origin. The form therefore submits to an action rather than fetching, which
 * also means it works before React has hydrated — a login is the one form on the site
 * that has to.
 *
 * The same schema that validates the request in Nest validates it here, so an obvious
 * refusal costs no round trip to the API and both sides read the same.
 */
export async function loginAction(
  next: string,
  _state: FormErrors,
  formData: FormData,
): Promise<FormErrors> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { message: null, fields: toFieldErrors(parsed.error.issues) };
  }

  try {
    await authApi.login(parsed.data);
  } catch (error) {
    return toFormErrors(error);
  }

  // The header sits in the root layout, which a navigation between two routes that share
  // it does not re-render — it would go on offering "Sign in" to somebody who just used it.
  refresh();

  // Checked once more even though the page already narrowed it: an action is an endpoint
  // of its own, and this one ends in a redirect.
  redirect(toLocalPath(next, ROUTES.profile));
}
