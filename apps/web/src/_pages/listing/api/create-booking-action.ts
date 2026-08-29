"use server";

import { refresh, revalidateTag, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { createBookingSchema } from "@repo/contracts";
import { bookingsApi } from "#shared/api";
import { availabilityTag, CATALOGUE_TAG, ROUTES } from "#shared/config";
import { toFieldErrors, toFormErrors, type FormErrors } from "#shared/lib";

/**
 * Taking a hold. The listing is bound by the page rather than submitted with the form —
 * the same reason `ownerId` is not on `createListingSchema`: what a request may name is
 * decided by the screen it was made from, not by a field somebody can retype.
 *
 * `createBookingSchema` is the schema Nest validates the body with, so the obvious
 * mistakes — a check-out before the check-in, a stay in the past — are refused before a
 * request is spent. What it cannot answer is whether the nights are free: that is a
 * question about other rows, and the only place it can be settled without a race is
 * inside the transaction that locks the listing. Its answer arrives here as a `409` and
 * is shown the way every other refusal is.
 */
export async function createBookingAction(
  listingId: string,
  _state: FormErrors,
  formData: FormData,
): Promise<FormErrors> {
  const parsed = createBookingSchema.safeParse({
    listingId,
    from: formData.get("from"),
    to: formData.get("to"),
  });

  if (!parsed.success) {
    return { message: null, fields: toFieldErrors(parsed.error.issues) };
  }

  try {
    await bookingsApi.create(parsed.data);
  } catch (error) {
    return toFormErrors(error);
  }

  // Two caches, and the difference between them is who has to see the change at once.
  // The guest who just took these nights must not be shown a calendar that still offers
  // them, so their own read waits for a fresh answer; everybody else can be served the
  // stale catalogue while it is refetched behind them.
  updateTag(availabilityTag(listingId));
  revalidateTag(CATALOGUE_TAG, "max");
  // Their bookings are read `no-store` and are not in the Data Cache at all. What this
  // clears is the router cache in their browser, which would otherwise show the list as
  // it was a moment before they added to it.
  refresh();
  redirect(ROUTES.bookings);
}
