import type { ReviewSummary } from "@repo/contracts";
import { ApiResponseError, ApiUnreachableError, reviewsApi } from "#shared/api";

/**
 * What hosts have said about this account, in sum — the count and the mean the profile
 * shows, and what decides if it offers the page of them. Asked of the API rather than of
 * the role: a guest an admin has since made a host or an admin is still the subject of
 * their old stays. One row is the least a page can be asked for; the summary counts the
 * whole list regardless.
 *
 * `no-store` for the reason `readGuestReviews` gives. A refusal or an unreachable API is
 * `null`: the summary is a convenience, and the profile should not go down with it.
 */
export async function readReviewSummaryOf(
  userId: string,
): Promise<ReviewSummary | null> {
  try {
    const { summary } = await reviewsApi.ofGuest(
      userId,
      { sort: "newest", limit: 1 },
      { cache: "no-store" },
    );

    return summary;
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
