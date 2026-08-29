"use server";

import { refresh, revalidateTag, updateTag } from "next/cache";
import { bookingsApi } from "#shared/api";
import { availabilityTag, CATALOGUE_TAG } from "#shared/config";
import { NO_FORM_ERRORS, toFormErrors, type FormErrors } from "#shared/lib";

/**
 * Cancelling a stay. Unlike the other actions here this one does not redirect: the list it
 * was called from is where the row belongs, now saying `Cancelled` — so what it returns is
 * either a message for the dialog or nothing at all.
 *
 * The listing is bound alongside the booking because the nights it held go back on offer,
 * and the two cached reads that said otherwise are named after the listing rather than
 * after the booking.
 *
 * It takes neither the previous state nor the form: both ids are bound by the card and
 * there is nothing on the form to read. `useActionState` still calls it with both, which
 * a shorter signature accepts.
 */
export async function cancelBookingAction(
  bookingId: string,
  listingId: string,
): Promise<FormErrors> {
  try {
    await bookingsApi.remove(bookingId);
  } catch (error) {
    // A 404 for a hold that lapsed while the dialog was open, a 403 for a booking that was
    // never this caller's to cancel, an unreachable API. Each of them belongs next to the
    // button that provoked it.
    return toFormErrors(error);
  }

  updateTag(availabilityTag(listingId));
  revalidateTag(CATALOGUE_TAG, "max");
  // This list is read `no-store`, so nothing of it is in the Data Cache; what has to be
  // thrown away is the copy the visitor's own router is holding.
  refresh();

  return NO_FORM_ERRORS;
}
