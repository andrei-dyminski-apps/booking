import type { ListingPage, ListingQuery } from "@repo/contracts";
import {
  listingsApi,
  pageOrNullOnStaleCursor,
  type ReadOptions,
} from "#shared/api";
import { CATALOGUE_TAG, HOLD_SWEEP_REVALIDATE } from "#shared/config";

/**
 * The first cached read of this application, and the first one that could be: everything
 * before it is personal — a session, an owner's own listings — and the Data Cache is keyed
 * by URL and shared with whoever asks next. A page of the catalogue is the same bytes for
 * everybody, so it is stored under its URL and tagged, and a listing created, edited or
 * retired clears every page of it at once.
 *
 * The tag is not the whole story, which is why there is a lifetime beside it: a hold
 * lapses on a timer, and no mutation of this application announces that. What the number
 * is and why it is that one is written where it is named.
 */
const CATALOGUE_READ: ReadOptions = {
  next: { revalidate: HOLD_SWEEP_REVALIDATE, tags: [CATALOGUE_TAG] },
};

/**
 * One page of the catalogue, or `null` for a cursor this API will not read — the recovery
 * itself, and why it is a `null` rather than a silent first page, is in
 * `pageOrNullOnStaleCursor`.
 */
export async function readCataloguePage(
  query: ListingQuery,
): Promise<ListingPage | null> {
  return pageOrNullOnStaleCursor(
    () => listingsApi.page(query, CATALOGUE_READ),
    query.cursor,
  );
}
