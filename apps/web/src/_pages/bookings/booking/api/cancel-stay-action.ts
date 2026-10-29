"use server";

import { refresh, revalidateTag, updateTag } from "next/cache";
import { bookingsApi } from "#shared/api";
import { availabilityTag, CATALOGUE_TAG } from "#shared/config";
import { NO_FORM_ERRORS, toFormErrors, type FormErrors } from "#shared/lib";

/**
 * Cancelling from the stay's own page. An action rather than a browser call because the
 * nights it frees are in the Data Cache, which only the server can invalidate — and it
 * cancels as well as invalidates, so the cache is thrown away only after a cancellation
 * this very call made. An action is an endpoint anybody can call: one that only
 * invalidated would let whoever may read a cancelled stay empty the catalogue's cache in a
 * loop, while a second cancel of the same stay is refused by the API and invalidates
 * nothing.
 *
 * The listing whose nights come free is read off the API's answer, not taken from the
 * browser, unlike the list's action which binds the one its card drew: here only the id
 * travels.
 */
export async function cancelStayAction(bookingId: string): Promise<FormErrors> {
  let listingId: string;

  try {
    listingId = (await bookingsApi.get(bookingId, { cache: "no-store" }))
      .listingId;
    await bookingsApi.remove(bookingId);
  } catch (error) {
    // A stay that is not this caller's, one that moved on while the dialog was open, an
    // unreachable API. Each of them belongs next to the button that provoked it.
    return toFormErrors(error);
  }

  // The guest who just let these nights go must see them free on the listing they open
  // next, as `cancelBookingAction` makes sure on the list; the catalogue can be stale.
  updateTag(availabilityTag(listingId));
  revalidateTag(CATALOGUE_TAG, "max");
  refresh();

  return NO_FORM_ERRORS;
}
