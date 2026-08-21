import { roleSchema, type Role } from "@repo/contracts";
import type { Role as PrismaRole } from "../generated/prisma/client";

/**
 * The contract union and the Prisma enum have to name the same roles, and only this file
 * sees both. `toUser` in UserRepository already fails to compile on a role Prisma has and
 * the contract does not — assigning the row to the contract type is what catches it. This
 * covers the other direction, which nothing else would notice.
 */
export const ROLES = roleSchema.options satisfies readonly PrismaRole[];

/** What the guard puts on the request — everything the access token carries, nothing more. */
export type AuthenticatedUser = {
  id: string;
  email: string;
  role: Role;
};

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: Role;
};

/**
 * `jti` identifies the single token (that is the row looked up on refresh), `fam` the
 * chain it belongs to — one login, however many rotations.
 */
export type RefreshTokenPayload = {
  sub: string;
  jti: string;
  fam: string;
};

/**
 * Everything the refresh row needs; the token itself is never stored. It lives here rather
 * than beside the service that mints it, because the repository that stores it would
 * otherwise have to import from a service — the direction the layering forbids.
 */
export type IssuedRefreshToken = {
  jti: string;
  familyId: string;
  hash: string;
  expiresAt: Date;
};
