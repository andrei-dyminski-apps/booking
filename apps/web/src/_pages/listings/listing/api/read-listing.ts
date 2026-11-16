import type { ListingDetail } from "@repo/contracts";
import { listingsApi } from "#shared/api";
import { listingTag } from "#shared/config";

/**
 * The listing's row, from the Data Cache under its own tag. No lifetime beside the tag,
 * unlike the availability: nothing about the row changes on a timer, so the writes that
 * name this tag are the whole of its invalidation. `false` is how that is spelled — an
 * absent `revalidate` would leave the read uncached and the tag pointing at nothing.
 *
 * One function for the page and its metadata, so the two ask under the same URL and
 * options and the second read is the first one's cached answer.
 */
export function readListing(id: string): Promise<ListingDetail> {
  return listingsApi.get(id, {
    next: { revalidate: false, tags: [listingTag(id)] },
  });
}
