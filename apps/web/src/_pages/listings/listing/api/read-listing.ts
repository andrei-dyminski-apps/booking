import { cacheLife, cacheTag } from "next/cache";
import type { ListingDetail } from "@repo/contracts";
import { answerOf, listingsApi } from "#shared/api";
import { listingTag } from "#shared/config";

/**
 * The listing's row, cached under its own tag. No lifetime beside the tag, unlike the
 * availability: nothing about the row changes on a timer, so the writes that name this tag
 * are the whole of its invalidation, and `"max"` is how that is spelled.
 *
 * One function for the page and its metadata, so the two ask with the same arguments and
 * the second read is the first one's cached answer.
 */
export function readListing(id: string): Promise<ListingDetail> {
  return listingsApi.get(id, {
    cached: async (url) => {
      "use cache";

      cacheLife("max");
      cacheTag(listingTag(id));

      return await answerOf(url);
    },
  });
}
