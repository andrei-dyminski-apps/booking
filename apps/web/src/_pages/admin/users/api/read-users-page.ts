import type { UserPage, UserQuery } from "@repo/contracts";
import {
  pageOrNullOnStaleCursor,
  usersApi,
  type ReadOptions,
} from "#shared/api";

/**
 * Never cached: it is the admin's session that may read it, and the Data Cache is keyed
 * by URL and shared between visitors — an entry here would be every account on the site,
 * waiting for the next person who spells the same address.
 */
const USERS_READ: ReadOptions = { cache: "no-store" };

/** One page of accounts, or `null` for a cursor the API will not read. */
export async function readUsersPage(
  query: UserQuery,
): Promise<UserPage | null> {
  return pageOrNullOnStaleCursor(
    () => usersApi.page(query, USERS_READ),
    query.cursor,
  );
}
