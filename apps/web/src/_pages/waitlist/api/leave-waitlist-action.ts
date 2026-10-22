"use server";

import { refresh } from "next/cache";
import { waitlistApi } from "#shared/api";
import { NO_FORM_ERRORS, toFormErrors, type FormErrors } from "#shared/lib";

/**
 * Leaving the waitlist for one range. No redirect: the list it was called from is where
 * the visitor stays, one row shorter once `refresh()` has re-rendered it — the read is
 * `no-store`, so the router cache in their browser is the only copy to throw away.
 *
 * Nothing cached changes either: an entry holds no nights, so neither the calendar nor the
 * catalogue has anything to say about it.
 */
export async function leaveWaitlistAction(
  entryId: string,
): Promise<FormErrors> {
  try {
    await waitlistApi.leave(entryId);
  } catch (error) {
    // A 404 for an entry already gone — left in another tab, or taken off the list when
    // its nights came free and the notice went out — or an unreachable API.
    return toFormErrors(error);
  }

  refresh();

  return NO_FORM_ERRORS;
}
