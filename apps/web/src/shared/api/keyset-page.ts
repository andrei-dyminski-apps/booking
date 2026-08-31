import { HTTP_STATUS } from "../config";
import { ApiResponseError } from "./http-client";

/**
 * The result of `read`, or `null` when the API refused the cursor it carried.
 *
 * Every cursor is issued by the previous page's `nextCursor` and decoded only by the API,
 * so a `400` on a request that carried one means the value in the URL was typed rather
 * than followed — or written under an ordering that has since changed. Answering the first
 * page instead would answer a different question than the link asked, so the caller shows
 * that the place was lost rather than starting over quietly. Every other failure
 * propagates: the filters beside the cursor have already been through the contract, so a
 * refusal with no cursor to blame is a drift from it.
 *
 * The two paged reads differ only in their `ReadOptions` — the catalogue is cached and
 * tagged, the stays are `no-store` — and that decision stays at each call site; this is
 * the recovery both of them share.
 */
export async function pageOrNullOnStaleCursor<T>(
  read: () => Promise<T>,
  cursor: string | undefined,
): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (
      cursor !== undefined &&
      error instanceof ApiResponseError &&
      error.status === HTTP_STATUS.BAD_REQUEST
    ) {
      return null;
    }

    throw error;
  }
}
