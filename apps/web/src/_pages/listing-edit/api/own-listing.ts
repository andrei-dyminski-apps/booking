import { notFound } from "next/navigation";
import type { Listing } from "@repo/contracts";
import { listingsApi } from "#shared/api";
import { listingTag } from "#shared/config";
import { orNotFound } from "#shared/lib";

/**
 * The row this screen edits, or nothing.
 *
 * Two answers become the same 404 here. The API lets every signed-in role read a listing
 * — the catalogue is not a secret — so a row belonging to another owner comes back with a
 * 200 and would render an edit form the `PATCH` behind it refuses. This section is the
 * owner's own, so somebody else's listing is not there to be found either.
 *
 * The check is not the authorization: `ListingService` compares the owner of the row on
 * every write regardless of what this decides. What it settles is which screen the
 * visitor is shown.
 *
 * The read is cached and tagged like every other read of a listing — the answer is public
 * and identical for everybody, and it is the ownership test above rather than the request
 * that makes this screen personal. What keeps an author from editing a stale copy of
 * their own row is `updateTag` in the action that saved it.
 */
export async function ownListing(
  ownerId: string,
  id: string,
): Promise<Listing> {
  const listing = await orNotFound(
    listingsApi.get(id, {
      next: { revalidate: false, tags: [listingTag(id)] },
    }),
  );

  if (listing.ownerId !== ownerId) notFound();

  return listing;
}
