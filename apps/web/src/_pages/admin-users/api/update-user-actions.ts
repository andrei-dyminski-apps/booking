"use server";

import { refresh } from "next/cache";
import { updateUserSchema, type UpdateUserInput } from "@repo/contracts";
import { usersApi } from "#shared/api";
import {
  NO_FORM_ERRORS,
  toFieldErrors,
  toFormErrors,
  type FormErrors,
} from "#shared/lib";

/**
 * A new role for an account. The box is a closed set and cannot hold anything else on the
 * screen, but the action is an endpoint of its own — what reaches it is `FormData`
 * somebody could have spelled by hand — so `updateUserSchema` reads it first, the same
 * schema the API validates the body with.
 *
 * Neither action redirects: the row belongs where it is, now saying something different,
 * and `refresh()` is what re-renders the list. It is read `no-store`, so nothing of it is
 * in the Data Cache; what is thrown away is the copy the admin's own router holds.
 */
export async function changeRoleAction(
  userId: string,
  _state: FormErrors,
  form: FormData,
): Promise<FormErrors> {
  const parsed = updateUserSchema.safeParse({ role: form.get("role") });

  if (!parsed.success) {
    return { message: null, fields: toFieldErrors(parsed.error.issues) };
  }

  return update(userId, parsed.data);
}

/**
 * Blocking or reopening an account. The direction is bound by the button rather than read
 * from the form: there is nothing on that form to read, and each button only ever means
 * one of the two.
 */
export async function setBlockedAction(
  userId: string,
  blocked: boolean,
): Promise<FormErrors> {
  return update(userId, { blocked });
}

async function update(
  userId: string,
  change: UpdateUserInput,
): Promise<FormErrors> {
  try {
    await usersApi.update(userId, change);
  } catch (error) {
    // A 403 for the admin's own account, a 404 for one that has gone, an unreachable API:
    // each belongs next to the control that provoked it.
    return toFormErrors(error);
  }

  refresh();

  return NO_FORM_ERRORS;
}
