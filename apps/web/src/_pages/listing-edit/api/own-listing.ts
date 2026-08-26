import { notFound } from "next/navigation";
import type { Listing } from "@repo/contracts";
import { ApiResponseError, listingsApi } from "#shared/api";
import { HTTP_STATUS } from "#shared/config";

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
 */
export async function ownListing(
  ownerId: string,
  id: string,
): Promise<Listing> {
  const listing = await read(id);

  if (listing.ownerId !== ownerId) notFound();

  return listing;
}

async function read(id: string): Promise<Listing> {
  try {
    return await listingsApi.get(id, { cache: "no-store" });
  } catch (error) {
    if (
      error instanceof ApiResponseError &&
      error.status === HTTP_STATUS.NOT_FOUND
    ) {
      notFound();
    }

    throw error;
  }
}
