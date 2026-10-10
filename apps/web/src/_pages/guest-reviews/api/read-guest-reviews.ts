import type { ReviewPage, ReviewQuery } from "@repo/contracts";
import { pageOrNullOnStaleCursor, reviewsApi } from "#shared/api";
import { orNotFound } from "#shared/lib";

/**
 * One page of what hosts said about a guest. `no-store`: the list is scoped to the session
 * — the guest, the hosts they asked to stay with, an admin — so it is personal data and
 * never goes near the Data Cache. A caller outside that scope gets the API's `404`, which
 * is this route's not-found; a cursor the API will not read is `null`, as on every paged
 * screen.
 */
export function readGuestReviews(
  guestId: string,
  query: ReviewQuery,
): Promise<ReviewPage | null> {
  return orNotFound(
    pageOrNullOnStaleCursor(
      () => reviewsApi.ofGuest(guestId, query, { cache: "no-store" }),
      query.cursor,
    ),
  );
}
