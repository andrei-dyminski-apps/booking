"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { joinWaitlistSchema, type JoinWaitlistInput } from "@repo/contracts";
import { ApiResponseError, waitlistApi } from "#shared/api";
import { availabilityTag, HTTP_STATUS, ROUTES } from "#shared/config";
import { toFieldErrors, toFormErrors, type FormErrors } from "#shared/lib";
import type { ReservationErrors } from "../model/reservation-errors";

/**
 * Joining the waitlist for nights the calendar draws as taken. The listing is bound by the
 * page for the reason `createBookingAction` gives, and the schema is the same one, so the
 * form's own refusals read the same whichever of the two it submits to.
 *
 * Nothing cached changes on success — an entry holds no nights — so all it does is take the
 * visitor to their waitlist, where the new entry is listed.
 */
export async function joinWaitlistAction(
  listingId: string,
  _state: FormErrors,
  values: JoinWaitlistInput,
): Promise<ReservationErrors> {
  const parsed = joinWaitlistSchema.safeParse({ ...values, listingId });

  if (!parsed.success) {
    return {
      message: null,
      fields: toFieldErrors(parsed.error.issues),
      stale: false,
    };
  }

  try {
    await waitlistApi.join(parsed.data);
  } catch (error) {
    // A `409` is only ever nights that came free since the calendar was read — a full list
    // is a `403`, which says nothing about the nights and leaves the cache alone. The
    // calendar is read again, and the form offers to hold the nights instead, beside the
    // message saying so.
    const stale =
      error instanceof ApiResponseError &&
      error.status === HTTP_STATUS.CONFLICT;

    if (stale) {
      updateTag(availabilityTag(listingId));
      refresh();
    }

    return { ...toFormErrors(error), stale };
  }

  redirect(ROUTES.waitlist);
}
