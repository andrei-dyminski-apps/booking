"use server";

import { refresh, updateTag } from "next/cache";
import { reviewsApi } from "#shared/api";
import { listingReviewsTag } from "#shared/config";
import { NO_FORM_ERRORS, toFormErrors, type FormErrors } from "#shared/lib";

/**
 * An admin removing a review. Like cancelling a stay it does not redirect — the list it was
 * called from is where the admin stays, one row shorter.
 *
 * The listing is bound by the screen rather than returned by the API: the button on a
 * listing's page knows which listing it is on, and that is the one cached read that has to
 * forget the review. `null` is the guest's page, whose read is `no-store` and has nothing
 * in the Data Cache to forget. `updateTag` rather than `revalidateTag`, because the admin is
 * the one about to read that page and must not be shown the review they just removed.
 */
export async function deleteReviewAction(
  reviewId: string,
  listingId: string | null,
): Promise<FormErrors> {
  try {
    await reviewsApi.remove(reviewId);
  } catch (error) {
    // A 404 for a review another admin removed first, an unreachable API.
    return toFormErrors(error);
  }

  if (listingId !== null) updateTag(listingReviewsTag(listingId));
  refresh();

  return NO_FORM_ERRORS;
}
