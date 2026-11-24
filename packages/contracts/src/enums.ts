/**
 * The enums the browser needs as values before it needs any schema — `ROUTES` in
 * `apps/web` names a role and a status, and nearly every component of its shell reaches
 * `ROUTES`. Derived from a schema with `.enum`, each of them made its file evaluate
 * `z.enum(...)` on import, and every page of the site downloaded zod for two string
 * constants. Kept here, in a file that imports nothing, the schemas are built from them
 * instead (`z.enum(Role)`), so there is still one list per enum.
 */

/** Kept in sync with the `Role` enum of the Prisma schema; `RolesGuard` in `apps/api` is what enforces it. */
export const Role = {
  USER: "USER",
  ADMIN: "ADMIN",
} as const;

export type Role = (typeof Role)[keyof typeof Role];

/** The capacity in which someone takes part in a scenario. */
export const ActorKind = {
  GUEST: "guest",
  HOST: "host",
  ADMIN: "admin",
} as const;

export type ActorKind = (typeof ActorKind)[keyof typeof ActorKind];

/**
 * Open until a person has sent the money back some other way and said how; resolved after,
 * kept as the record of it.
 */
export const RefundFailureStatus = {
  OPEN: "OPEN",
  RESOLVED: "RESOLVED",
} as const;

export type RefundFailureStatus =
  (typeof RefundFailureStatus)[keyof typeof RefundFailureStatus];
