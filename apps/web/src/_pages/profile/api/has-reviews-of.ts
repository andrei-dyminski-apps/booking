import { ApiResponseError, ApiUnreachableError, reviewsApi } from "#shared/api";

/**
 * Whether hosts have said anything about this account — what decides if the profile
 * offers the page of it. Asked of the API rather than of the role: a guest an admin has
 * since made a host or an admin is still the subject of their old stays, and a guest who
 * has never been reviewed has nothing to open. One row is the least a page can be asked
 * for; the answer is read off the summary, which counts the whole list.
 *
 * `no-store` for the reason `readGuestReviews` gives. A refusal or an unreachable API is
 * `false`: the link is a convenience, and the profile should not go down with it.
 */
export async function hasReviewsOf(userId: string): Promise<boolean> {
  try {
    const { summary } = await reviewsApi.ofGuest(
      userId,
      { sort: "newest", limit: 1 },
      { cache: "no-store" },
    );

    return summary.count > 0;
  } catch (error) {
    if (
      error instanceof ApiResponseError ||
      error instanceof ApiUnreachableError
    ) {
      return false;
    }

    throw error;
  }
}
