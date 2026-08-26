"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { listingsApi } from "#shared/api";
import { ROUTES } from "#shared/config";
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

  refresh();
  redirect(ROUTES.dashboard);
}
