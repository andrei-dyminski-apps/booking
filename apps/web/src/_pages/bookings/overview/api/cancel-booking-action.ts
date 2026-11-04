"use server";

import { refresh, revalidateTag, updateTag } from "next/cache";
import { cancelBookingSchema, type CancelBookingInput } from "@repo/contracts";
import { bookingsApi } from "#shared/api";
import { availabilityTag, CATALOGUE_TAG } from "#shared/config";
import {
  NO_FORM_ERRORS,
  toFieldErrors,
  toFormErrors,
  type FormErrors,
} from "#shared/lib";

/**
 * Cancelling a stay. Unlike the other actions here this one does not redirect: the list it
 * was called from is where the row belongs, now saying `Cancelled` — so what it returns is
 * either a message for the dialog or nothing at all.
 *
 * The listing is bound alongside the booking because the nights it held go back on offer,
 * and the two cached reads that said otherwise are named after the listing rather than
 * after the booking. Whether the reason was the host's to give is not this action's to
 * know: the API asks the rows who is cancelling and refuses a host's blank reason.
 */
export async function cancelBookingAction(
  bookingId: string,
  listingId: string,
  _state: FormErrors,
  values: CancelBookingInput,
): Promise<FormErrors> {
  const parsed = cancelBookingSchema.safeParse(values);

  if (!parsed.success) {
    return { message: null, fields: toFieldErrors(parsed.error.issues) };
  }

  try {
    await bookingsApi.remove(bookingId, parsed.data);
  } catch (error) {
    // A 404 for a hold that lapsed while the dialog was open, a 409 for a stay that began,
    // an unreachable API. Each of them belongs next to the button that provoked it.
    return toFormErrors(error);
  }

  updateTag(availabilityTag(listingId));
  revalidateTag(CATALOGUE_TAG, "max");
  // This list is read `no-store`, so nothing of it is in the Data Cache; what has to be
  // thrown away is the copy the visitor's own router is holding.
  refresh();

  return NO_FORM_ERRORS;
}
