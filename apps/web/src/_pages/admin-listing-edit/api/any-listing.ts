import type { Listing } from "@repo/contracts";
import { listingsApi } from "#shared/api";
import { listingTag } from "#shared/config";
import { orNotFound } from "#shared/lib";

/**
 * The row this screen edits, whoever owns it. The owner's screen narrows the same read to
 * the session's own rows (`own-listing.ts`); an admin's is every row, which is the API's
 * rule written from this side — `ownsOrIsAdmin` lets an admin through on any listing.
 *
 * Cached and tagged like every other read of one listing: the answer is public and the
 * same for everybody, and `updateTag` in the action that saves it is what keeps the admin
 * from editing a stale copy.
 */
export function anyListing(id: string): Promise<Listing> {
  return orNotFound(
    listingsApi.get(id, {
      next: { revalidate: false, tags: [listingTag(id)] },
    }),
  );
}
