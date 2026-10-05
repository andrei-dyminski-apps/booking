import type { ListingPage, ListingQuery } from "@repo/contracts";
import {
  listingsApi,
  pageOrNullOnStaleCursor,
  type ReadOptions,
} from "#shared/api";

/**
 * The same public read the catalogue makes, and deliberately not the same cache. This is
 * the screen an admin lands on after saving or retiring a listing, and the catalogue's
 * tag is revalidated with `"max"` — stale while it refetches — so a cached read here
 * would show the admin the row they have just changed as it was before. A management
 * screen reads what is true now; the catalogue keeps its cache for everybody else.
 */
const MANAGED_READ: ReadOptions = { cache: "no-store" };

/** One page of every offered listing, or `null` for a cursor the API will not read. */
export async function readListingsPage(
  query: ListingQuery,
): Promise<ListingPage | null> {
  return pageOrNullOnStaleCursor(
    () => listingsApi.page(query, MANAGED_READ),
    query.cursor,
  );
}
