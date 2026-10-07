import type { ManagedUserDetail } from "@repo/contracts";
import { usersApi } from "#shared/api";
import { orNotFound } from "#shared/lib";

/**
 * One account, or a 404 for an id that names none — the account's own page reads it, and
 * so does the heading of a list narrowed by `?ownerId=`. Never cached, for the reason the
 * list of accounts is not: see `read-users-page.ts`.
 */
export function anyUser(id: string): Promise<ManagedUserDetail> {
  return orNotFound(usersApi.get(id, { cache: "no-store" }));
}
