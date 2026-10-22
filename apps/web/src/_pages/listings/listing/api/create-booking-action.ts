"use server";

import { refresh, revalidateTag, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { createBookingSchema, type CreateBookingInput } from "@repo/contracts";
import { ApiResponseError, bookingsApi } from "#shared/api";
import {
  availabilityTag,
  CATALOGUE_TAG,
  HTTP_STATUS,
  ROUTES,
} from "#shared/config";
import { toFieldErrors, toFormErrors, type FormErrors } from "#shared/lib";
import type { ReservationErrors } from "../model/reservation-errors";

/**
 * Taking a hold. The listing is bound by the page rather than taken from the payload —
 * the same reason `ownerId` is not on `createListingSchema`: what a request may name is
 * decided by the screen it was made from, not by a field somebody can retype. The form
 * carries a `listingId` because the schema it validates against has one, and the value
 * below overwrites it for exactly that reason.
 *
 * `createBookingSchema` is the schema Nest validates the body with, so the obvious
 * mistakes — a check-out before the check-in, a stay in the past — are refused in the
 * browser before a request is spent, and refused again here because an action is an
 * endpoint of its own. What it cannot answer either time is whether the nights are free:
 * that is a question about other rows, and the only place it can be settled without a
 * race is inside the transaction that locks the listing. Its answer arrives here as a
 * `409` and is shown the way every other refusal is, with `stale` set: the form remembers
 * these nights as taken even when they lie past the window its calendar draws.
 */
export async function createBookingAction(
  listingId: string,
  _state: FormErrors,
  values: CreateBookingInput,
): Promise<ReservationErrors> {
  const parsed = createBookingSchema.safeParse({ ...values, listingId });

  if (!parsed.success) {
    return {
      message: null,
      fields: toFieldErrors(parsed.error.issues),
      stale: false,
    };
  }

  try {
    await bookingsApi.create(parsed.data);
  } catch (error) {
    // Somebody else holds some of these nights, and the calendar the visitor chose them
    // from did not know: it is read again, so the taken nights are drawn and the form
    // offers the waitlist for them in place of a hold.
    const stale =
      error instanceof ApiResponseError &&
      error.status === HTTP_STATUS.CONFLICT;

    if (stale) {
      updateTag(availabilityTag(listingId));
      refresh();
    }

    return { ...toFormErrors(error), stale };
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
