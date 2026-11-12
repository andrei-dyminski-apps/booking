"use server";

import { refresh, revalidateTag, updateTag } from "next/cache";
import type { EndStayEarlyInput } from "@repo/contracts";
import { bookingsApi } from "#shared/api";
import { availabilityTag, CATALOGUE_TAG } from "#shared/config";
import { NO_FORM_ERRORS, toFormErrors, type FormErrors } from "#shared/lib";

/**
 * Ending a stay early from its own page. An action for the reason `cancelStayAction` is one:
 * the nights after the new check-out come free, and those are in the Data Cache, which only
 * the server can invalidate — and only after an early end this very call made, so the action
 * is no endpoint for emptying the catalogue's cache in a loop. The listing is read off the
 * API's answer; the id and the terms the dialog stated travel, bound by the page — the API
 * refuses a check-out the day has left behind and a refund that has shrunk since, so a dialog
 * left open past the listing's midnight, or past a refund recorded meanwhile, never ends the
 * stay on terms it did not show.
 */
export async function endStayEarlyAction(
  bookingId: string,
  terms: EndStayEarlyInput,
): Promise<FormErrors> {
  let listingId: string;

  try {
    listingId = (await bookingsApi.get(bookingId, { cache: "no-store" }))
      .listingId;
    await bookingsApi.endEarly(bookingId, {
      checkOut: terms.checkOut,
      refundCents: terms.refundCents,
    });
  } catch (error) {
    // A stay that moved on while the dialog was open, a day that turned under it, a disputed
    // payment, an unreachable API — each belongs next to the button that provoked it.
    return toFormErrors(error);
  }

  updateTag(availabilityTag(listingId));
  revalidateTag(CATALOGUE_TAG, "max");
  refresh();

  return NO_FORM_ERRORS;
}
