import type { ListingPage, ListingQuery } from "@repo/contracts";
import { ApiResponseError, listingsApi, type ReadOptions } from "#shared/api";
import { CATALOGUE_TAG, HTTP_STATUS } from "#shared/config";

/**
 * The first cached read of this application, and the first one that could be: everything
 * before it is personal — a session, an owner's own listings — and the Data Cache is keyed
 * by URL and shared with whoever asks next. A page of the catalogue is the same bytes for
 * everybody, so it is stored under its URL and tagged, and a listing created, edited or
 * retired clears every page of it at once.
 *
 * The tag is not the whole story, which is why there is a lifetime beside it. A hold
 * lapses fifteen minutes after it was taken and puts its nights back on offer, and no
 * mutation of this application announces that — the API releases it from a queue. A
 * minute is the interval of the sweep behind that queue, so this is the freshness the API
 * itself promises rather than a number picked for the feel of it.
 */
const CATALOGUE_READ: ReadOptions = {
  next: { revalidate: 60, tags: [CATALOGUE_TAG] },
};

/**
 * One page of the catalogue, or `null` for a cursor this API will not read.
 *
 * Every cursor is issued by a `nextCursor` of the previous page and decoded only by the
 * API, so a `400` means the value in the URL was typed rather than followed. Answering
 * the first page instead would answer a different question than the link asked, which is
 * the same reason the API refuses it rather than starting over quietly. Every other
 * status is still a failure and propagates: the filters beside it have already been
 * through the contract, so a refusal with no cursor to blame is a drift from it.
 */
export async function readCataloguePage(
  query: ListingQuery,
): Promise<ListingPage | null> {
  try {
    return await listingsApi.page(query, CATALOGUE_READ);
  } catch (error) {
    if (
      query.cursor !== undefined &&
      error instanceof ApiResponseError &&
      error.status === HTTP_STATUS.BAD_REQUEST
    ) {
      return null;
    }

    throw error;
  }
}
