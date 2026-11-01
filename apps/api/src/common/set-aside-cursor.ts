import { setAsideSortSchema, type SetAsideSort } from "@repo/contracts";
import { z } from "zod";
import { decodeParts, encodeParts, type Page } from "./paging";

/**
 * The place a page of something set aside ends — a failed event, a bounced refund, a stuck
 * stay. All three are ordered by the moment they were set aside with their id behind it, so
 * they share this shape; the resource tag is what tells their cursors apart, the way the
 * tag of `src/common/paging.ts` always does.
 */
export type SetAsideCursor = { sort: SetAsideSort; at: Date; id: string };

export function encodeSetAsideCursor(
  resource: string,
  row: { at: string; id: string },
  sort: SetAsideSort,
): string {
  return encodeParts(resource, sort, row.at, row.id);
}

/**
 * The `nextCursor` of a page of the three lists: written from the last row, and only when
 * there is another page. `keyOf` names the moment and the id of a row, the one thing the
 * three spell differently.
 */
export function nextSetAsideCursor<Row>(
  resource: string,
  { items, hasMore }: Page<Row>,
  keyOf: (row: Row) => { at: string; id: string },
): string | null {
  const last = items.at(-1);

  return hasMore && last !== undefined
    ? encodeSetAsideCursor(resource, keyOf(last), "newest")
    : null;
}

/**
 * `null` for anything this cannot read, which the caller answers with a `400`. The id is
 * read against the schema of the column it names, which only the list knows: the
 * provider's text for an event or a refund (`evt_…`, `re_…`), a uuid for a stay — a
 * cursor naming an id the column cannot hold would otherwise reach the query and fail
 * there as a `500`.
 */
export function decodeSetAsideCursor(
  resource: string,
  raw: string,
  id: z.ZodType<string, string>,
): SetAsideCursor | null {
  const parts = decodeParts(resource, raw, {
    sort: setAsideSortSchema,
    id: z.string().min(1).pipe(id),
  });

  if (parts === null) return null;

  const at = z.iso.datetime().safeParse(parts.key);

  return at.success
    ? { sort: parts.sort, at: new Date(at.data), id: parts.id }
    : null;
}
