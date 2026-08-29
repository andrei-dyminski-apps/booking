"use server";

import { refresh, revalidateTag, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { listingsApi } from "#shared/api";
import { CATALOGUE_TAG, listingTag, ROUTES } from "#shared/config";
import { toFormErrors, type FormErrors } from "#shared/lib";

/**
 * The API retires the listing rather than removing the row — the stays booked against it
 * keep naming where they were — so from this screen it simply goes: out of the catalogue,
 * off the dashboard, 404 on the way back. What can still come back is a `404` for a row
 * an admin retired first, and the transport's own failure; both are the API's to word,
 * and `toFormErrors` carries either back to the button unchanged.
 *
 * It takes neither the previous state nor the form: the id is bound by the page and there
 * is nothing on the form to read. `useActionState` still calls it with both, which a
 * shorter signature accepts.
 */
export async function deleteListingAction(
  listingId: string,
): Promise<FormErrors> {
  try {
    await listingsApi.remove(listingId);
  } catch (error) {
    return toFormErrors(error);
  }

  // The row leaves the catalogue and starts answering 404 by id, so both cached reads
  // that still describe it are wrong. The one about this row is the author's own and is
  // waited for; the catalogue is everybody's and can be served stale while it refetches.
  updateTag(listingTag(listingId));
  revalidateTag(CATALOGUE_TAG, "max");
  refresh();
  redirect(ROUTES.dashboard);
}
