"use server";

import { refresh, updateTag } from "next/cache";
import { createReviewSchema, type CreateReviewInput } from "@repo/contracts";
import { reviewsApi } from "#shared/api";
import { listingReviewsTag } from "#shared/config";
import {
  NO_FORM_ERRORS,
  toFieldErrors,
  toFormErrors,
  type FormErrors,
} from "#shared/lib";

/**
 * Writing one half of a finished stay. The booking is bound by the card, and so is the
 * listing whenever the half is the guest's — that review is public, read on the listing's
 * page from the Data Cache, and the author is the one most likely to go and look at it
 * next, so `updateTag` rather than a stale-while-revalidate. A host's review of a guest
 * is read `no-store`, so `null` there and nothing to invalidate.
 *
 * Which half it is the API decides from the session; binding the listing only says which
 * cached page to forget, and a value that lied about it would forget the wrong one and
 * nothing worse.
 */
export async function reviewBookingAction(
  bookingId: string,
  listingId: string | null,
  _state: FormErrors,
  values: CreateReviewInput,
): Promise<FormErrors> {
  const parsed = createReviewSchema.safeParse(values);

  if (!parsed.success) {
    return { message: null, fields: toFieldErrors(parsed.error.issues) };
  }

  try {
    await reviewsApi.create(bookingId, parsed.data);
  } catch (error) {
    // A 409 for a half already written — in another tab — or a stay that stopped being
    // reviewable, a 404 for a booking this caller is not a side of, an unreachable API.
    return toFormErrors(error);
  }

  if (listingId !== null) updateTag(listingReviewsTag(listingId));
  // The stays are read `no-store`; what has to go is the router's copy, so the card comes
  // back saying the stay is reviewed and the button is gone with the dialog it opened.
  refresh();

  return NO_FORM_ERRORS;
}
