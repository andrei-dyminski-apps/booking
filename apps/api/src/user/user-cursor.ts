import { managedUserSchema, userSortSchema } from "@repo/contracts";
import type { ManagedUser, UserSort } from "@repo/contracts";
import {
  decodeParts,
  encodeParts,
  type CreatedAtCursor,
} from "../common/paging";

/**
 * The place in a list of accounts a page ends. Keyset for the reason the other two lists
 * are: a registration that lands while an admin is paging would shift every offset after
 * it, and under `newest` it lands exactly at the top.
 *
 * Both orderings sort by the same column, so the key always reads as a moment — the
 * `sort` is still carried, because `readCursor` refuses a cursor handed back under the
 * other one: page three of the newest accounts is not a place in the oldest.
 */
export type UserCursor = CreatedAtCursor;

/** The tag that keeps a `newest` cursor of the stays from reading as one of these. */
const RESOURCE = "users";

export function encodeCursor(user: ManagedUser, sort: UserSort): string {
  return encodeParts(RESOURCE, sort, user.createdAt, user.id);
}

/**
 * `null` for anything this cannot read, which the caller answers with a `400`. The key is
 * read against the contract's own rule for `createdAt`, so a cursor cannot name a moment
 * no account could have been created at.
 */
export function decodeCursor(raw: string): UserCursor | null {
  const parts = decodeParts(RESOURCE, raw, {
    sort: userSortSchema,
    id: managedUserSchema.shape.id,
  });

  if (parts === null) return null;

  const createdAt = managedUserSchema.shape.createdAt.safeParse(parts.key);

  return createdAt.success
    ? { sort: parts.sort, createdAt: new Date(createdAt.data), id: parts.id }
    : null;
}
