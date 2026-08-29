import { z } from "zod";
import { notFound } from "next/navigation";
import { ApiResponseError } from "../api";
import { HTTP_STATUS } from "../config";

/** Every id the API addresses a row by is one of these, in every schema of the contract. */
const recordId = z.uuid();

/**
 * The id a route was asked for, or a page that is not there.
 *
 * A path segment is untrusted text like any other, and the API refuses one that cannot be
 * an id with a `400` from `ParseUUIDPipe` — before it has looked for a row at all. That
 * status is a statement about the request rather than about the row, so it is not
 * something `orNotFound` may translate: the same status from a read whose window this
 * side computed would be a drift from the contract, and has to keep reaching the console.
 * What a page can settle for itself is that a segment which cannot name a row names
 * nothing, which is the 404 an id naming no row already gets.
 */
export function requireId(id: string): string {
  if (!recordId.safeParse(id).success) notFound();

  return id;
}

/**
 * A row the API says is not there is a page that is not there. Every screen built on a
 * single row makes the same translation, and each of them would otherwise have to
 * remember that only a 404 becomes one — an unreachable API and a 500 are failures of
 * this request rather than statements about the id in the URL, and have to propagate.
 *
 * A retired listing arrives here as well, and that is the answer this application wants:
 * `GET /listings/:id` refuses it to everybody, its owner included, because the read is
 * public and cached by URL. What a guest holding a stay against it sees instead is the
 * summary the booking itself carries.
 */
export async function orNotFound<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
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
