import { cacheLife, cacheTag } from "next/cache";
import type { AvailabilityQuery, ListingAvailability } from "@repo/contracts";
import { answerOf, listingsApi } from "#shared/api";
import { availabilityTag, HOLD_SWEEP_REVALIDATE } from "#shared/config";

/**
 * The nights taken in the window the calendar draws, cached under a tag of its own — a
 * booking changes what is free without touching the row. It carries a lifetime beside the
 * tag, unlike the row: a hold lapses on a timer, and no write of this application
 * announces that.
 */
export function readAvailability(
  id: string,
  window: AvailabilityQuery,
): Promise<ListingAvailability> {
  return listingsApi.availability(id, window, {
    cached: async (url) => {
      "use cache";

      cacheLife({ revalidate: HOLD_SWEEP_REVALIDATE });
      cacheTag(availabilityTag(id));

      return await answerOf(url);
    },
  });
}
