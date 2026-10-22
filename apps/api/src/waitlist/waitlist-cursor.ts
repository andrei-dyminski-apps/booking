import { waitlistDemandEntrySchema, waitlistSortSchema } from "@repo/contracts";
import type { WaitlistDemandEntry, WaitlistSort } from "@repo/contracts";
import { decodeParts, encodeParts } from "../common/paging";

/**
 * The place in the waitlist on somebody's listings a page ends — keyset, for the reason
 * `booking-cursor.ts` gives, and carrying the ordering it was issued under so a cursor of
 * one cannot be read as a place in the other.
 */
export type WaitlistCursor =
  | { sort: "newest"; createdAt: Date; id: string }
  | { sort: "checkInAsc"; from: Date; id: string };

/** The tag that keeps this list's cursors apart from the stays', which are spelled alike. */
const RESOURCE = "waitlist";

export function encodeCursor(
  entry: WaitlistDemandEntry,
  sort: WaitlistSort,
): string {
  return encodeParts(RESOURCE, sort, sortKey(entry, sort), entry.id);
}

/**
 * `null` for anything this cannot read; the caller answers that with a `400`. Each key is
 * read against the rule the contract writes for its column, as the stays' cursor does.
 */
export function decodeCursor(raw: string): WaitlistCursor | null {
  const parts = decodeParts(RESOURCE, raw, {
    sort: waitlistSortSchema,
    id: waitlistDemandEntrySchema.shape.id,
  });

  if (parts === null) return null;

  const { sort, key, id } = parts;

  switch (sort) {
    case "newest": {
      const createdAt =
        waitlistDemandEntrySchema.shape.createdAt.safeParse(key);

      return createdAt.success
        ? { sort, createdAt: new Date(createdAt.data), id }
        : null;
    }
    case "checkInAsc": {
      const from = waitlistDemandEntrySchema.shape.from.safeParse(key);

      return from.success ? { sort, from: new Date(from.data), id } : null;
    }
  }
}

/** Exhaustive, so a third ordering stops compiling here and in the repository's `afterCursor`. */
function sortKey(entry: WaitlistDemandEntry, sort: WaitlistSort): string {
  switch (sort) {
    case "newest":
      return entry.createdAt;
    case "checkInAsc":
      return entry.from;
  }
}
