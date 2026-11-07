"use server";

import { refresh } from "next/cache";
import { usersApi } from "#shared/api";
import { NO_FORM_ERRORS, toFormErrors, type FormErrors } from "#shared/lib";

/**
 * Blocking or reopening an account. The direction is bound by the button rather than read
 * from the form: there is nothing on that form to read, and each button only ever means
 * one of the two.
 *
 * It does not redirect: the row belongs where it is, now saying something different, and
 * `refresh()` is what re-renders the page. It is read `no-store`, so nothing of it is in
 * the Data Cache; what is thrown away is the copy the admin's own router holds.
 */
export async function setBlockedAction(
  userId: string,
  blocked: boolean,
): Promise<FormErrors> {
  try {
    await usersApi.update(userId, { blocked });
  } catch (error) {
    // A 403 for an admin's account, a 404 for one that has gone, an unreachable API:
    // each belongs next to the control that provoked it.
    return toFormErrors(error);
  }

  refresh();

  return NO_FORM_ERRORS;
}
