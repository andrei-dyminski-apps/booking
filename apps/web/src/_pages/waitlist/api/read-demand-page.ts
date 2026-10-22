import type { WaitlistDemandPage, WaitlistDemandQuery } from "@repo/contracts";
import { pageOrNullOnStaleCursor, waitlistApi } from "#shared/api";

/**
 * One page of the ranges waited for on the listings the caller may see, or `null` for a
 * cursor this API will not read — see `pageOrNullOnStaleCursor`. Personal, so `no-store`
 * like the stays: the scope is the session, not the address.
 */
export async function readDemandPage(
  query: WaitlistDemandQuery,
): Promise<WaitlistDemandPage | null> {
  return pageOrNullOnStaleCursor(() => waitlistApi.demand(query), query.cursor);
}
