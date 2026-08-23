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
