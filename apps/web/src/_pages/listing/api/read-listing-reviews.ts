import type { ReviewPage } from "@repo/contracts";
import { ApiResponseError, ApiUnreachableError, reviewsApi } from "#shared/api";
import { listingReviewsTag } from "#shared/config";

/**
 * The newest page of what guests said about a listing, from the Data Cache under a tag of
 * its own: a review changes neither the row nor the calendar. No lifetime beside the tag,
 * like the row's — a review written or removed is the whole of its invalidation.
 *
 * `null` when the API refuses or cannot be reached, instead of an error: the reviews are
 * the one part of the listing's screen it can be drawn without, and the calendar and the
 * booking form should not go down with them. A `404` is folded in as well — the listing's
 * own read beside this one is what answers it, with the route's not-found. Anything else
 * is a broken response rather than an unavailable one, and still throws.
 */
export async function readListingReviews(
  listingId: string,
  limit: number,
): Promise<ReviewPage | null> {
  try {
    return await reviewsApi.ofListing(
      listingId,
      { sort: "newest", limit },
      { next: { revalidate: false, tags: [listingReviewsTag(listingId)] } },
    );
  } catch (error) {
    if (
      error instanceof ApiResponseError ||
      error instanceof ApiUnreachableError
    ) {
      return null;
    }

    throw error;
  }
}
