import { Role } from "@repo/contracts";
import type { AuthenticatedUser } from "./auth.types";

/**
 * The second half of authorization: may this user act on a row that belongs to `ownerId`.
 *
 * Deliberately not a guard. A role is a claim of the access token and is known before the
 * handler runs; ownership is a property of a row and cannot be known until the row is
 * read — a guard that decided it would have to fetch the row itself, and the handler would
 * then fetch it a second time. So the role check stays in `RolesGuard`, this one lives in
 * the service beside the read, and the two answer different questions: `403` from the
 * guard means "not your kind of endpoint", `403` from here means "not your row".
 *
 * ADMIN passes without owning anything. That is the one place a hierarchy between roles
 * exists, and it is written here rather than in the guard, because it is a rule about
 * rows — an admin may edit any listing, and still may not create a booking, which a
 * hierarchy inside the guard would have granted along the way.
 */
export function ownsOrIsAdmin(
  user: AuthenticatedUser,
  ownerId: string,
): boolean {
  return user.id === ownerId || user.role === Role.ADMIN;
}
