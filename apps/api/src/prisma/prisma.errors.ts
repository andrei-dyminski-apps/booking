import { z } from "zod";
import { Prisma } from "../generated/prisma/client";

/**
 * The codes a read-then-write can lose its race to. Prisma exports no enum of its own —
 * `PrismaClientKnownRequestError.code` is a bare `string`, and the documentation compares
 * it against a literal — so the three this repository reacts to are named here, next to
 * the helper that reads them.
 */
export const PrismaErrorCode = {
  UniqueViolation: "P2002",
  ForeignKeyViolation: "P2003",
  RecordNotFound: "P2025",
} as const;

/**
 * The SQLSTATE Postgres raises for an `EXCLUDE` constraint violation. Prisma has no code
 * of its own for it — a `.create()` that hits `bookings_no_overlap` surfaces as a generic
 * `PrismaClientKnownRequestError` (`P2039` in Prisma 7) whose only dependable signal is
 * this class code, carried nested under the driver adapter error like every other
 * adapter-reported detail (see `violatedConstraint`).
 */
const EXCLUSION_VIOLATION_SQLSTATE = "23P01";

/**
 * The SQLSTATE of a `CHECK` constraint violation — `P2039` again on Prisma's side, so the
 * class code is read the way the exclusion's is.
 */
const CHECK_VIOLATION_SQLSTATE = "23514";

export type PrismaErrorCode =
  (typeof PrismaErrorCode)[keyof typeof PrismaErrorCode];

/**
 * Which driver reports which code is exactly the knowledge this function exists to keep in
 * one place, so a repository translates it into a domain error without naming the code
 * twice. The parameter takes the union above rather than a `string`: a mistyped code would
 * otherwise compile into a branch that never runs, and the 404 it was meant to produce
 * would reach the client as a 500.
 */
export function isPrismaError(
  error: unknown,
  code: PrismaErrorCode,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

/**
 * Not `meta.target` or `meta.field_name`, which every recipe for this reaches for: Prisma 7
 * talks to Postgres through a driver adapter, and an adapter error leaves those fields
 * unset. What the driver knows arrives nested instead, under this one path — which is why
 * the path lives here rather than being spelled out by each repository that digs for it.
 *
 * What sits at the end of it differs by violation, so the leaf is the caller's to describe:
 * a unique conflict reports `{ fields: [...] }`, a foreign key `{ index: "..." }`. Not
 * `z.strictObject` anywhere along the way — `meta` and `constraint` both carry sibling keys
 * the adapter is free to add, and rejecting them would make every violation unreadable.
 *
 * `null` for a shape this cannot read, including an adapter that reports no constraint at
 * all. What that silence should mean is a decision only the caller can take: it depends on
 * how many candidate constraints the write had, and on which wrong answer is worse.
 */
export function violatedConstraint<Constraint>(
  error: Prisma.PrismaClientKnownRequestError,
  leaf: z.ZodType<Constraint>,
): Constraint | null {
  // Two steps rather than one schema with `leaf` nested inside it: the path is fixed and
  // the leaf is the caller's, and composing them would infer the result of the whole parse
  // as the generic rather than as `Constraint`.
  const path = constraintPathSchema.safeParse(error.meta);

  if (!path.success) return null;

  const parsed = leaf.safeParse(path.data.driverAdapterError.cause.constraint);

  return parsed.success ? parsed.data : null;
}

const constraintPathSchema = z.object({
  driverAdapterError: z.object({
    cause: z.object({ constraint: z.unknown() }),
  }),
});

/**
 * True for a write that lost to the `EXCLUDE` constraint on `bookings` — two overlapping
 * active stays on one listing. The repository's locking transaction already refuses that,
 * so this only fires if a bug slips past it; the caller answers it the same `409` an
 * ordinary overlap gets. Read through the nested SQLSTATE rather than Prisma's own code,
 * which is generic here and could shift between versions.
 */
export function isExclusionViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;

  return (
    sqlStatePathSchema.safeParse(error.meta).data?.driverAdapterError.cause
      .code === EXCLUSION_VIOLATION_SQLSTATE
  );
}

/**
 * True for a write that broke the named `CHECK` constraint. Most of them are unreachable
 * over HTTP — the contract refuses the value first — and need no translation; this is for
 * one that holds a pair of columns a `PATCH` can reach one half of. The adapter reports no
 * constraint field for a `CHECK`, unlike a unique or a foreign key, so the name is read out
 * of the message Postgres words it in (`violates check constraint "<name>"`). Only the name
 * is relied on, never the words or the quotes around it: the server words the message in
 * its `lc_messages`, and a translation quotes an identifier its own way (`»<name>«`).
 */
export function isCheckViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;

  const cause = checkViolationPathSchema.safeParse(error.meta).data
    ?.driverAdapterError.cause;

  return (
    cause?.code === CHECK_VIOLATION_SQLSTATE &&
    namesIdentifier(cause.message, constraint)
  );
}

/**
 * Whether `identifier` stands in `message` as a whole name rather than as a part of a
 * longer one — the constraints of one table share a prefix (`listings_…`).
 */
function namesIdentifier(message: string, identifier: string): boolean {
  for (
    let at = message.indexOf(identifier);
    at !== -1;
    at = message.indexOf(identifier, at + 1)
  ) {
    const before = message.charAt(at - 1);
    const after = message.charAt(at + identifier.length);

    if (!IDENTIFIER_CHAR.test(before) && !IDENTIFIER_CHAR.test(after)) {
      return true;
    }
  }

  return false;
}

/** A character an unquoted Postgres identifier may continue with. */
const IDENTIFIER_CHAR = /^[\p{L}\p{N}_$]$/u;

const checkViolationPathSchema = z.object({
  driverAdapterError: z.object({
    cause: z.object({ code: z.string(), message: z.string() }),
  }),
});

const sqlStatePathSchema = z.object({
  driverAdapterError: z.object({
    cause: z.object({ code: z.string() }),
  }),
});
