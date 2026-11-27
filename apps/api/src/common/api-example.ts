import { tz } from "@date-fns/tz";
import { addDays } from "date-fns";
import type { z } from "zod";
import { toIsoDate } from "./iso-date";

/**
 * The schema with a body for /docs to fill "Try it out" with. Typed as the schema's input,
 * so an example that stops fitting the contract is a compile error rather than a request
 * /docs suggests and the API refuses. Not parsed: a refinement that reads today — a
 * check-in may not be in the past — would turn a stale example into a failed boot.
 */
export const withExample = <Schema extends z.ZodType>(
  schema: Schema,
  example: z.input<Schema>,
): Schema => schema.meta({ example });

/**
 * A day `days` from today, so an example stay is always one the API would take. Read when
 * the DTO module loads, which is a process start — a long-running dev server offers the
 * days of its own start until it restarts; /docs exists only in development.
 */
export const exampleDay = (days: number): string =>
  toIsoDate(addDays(new Date(), days, { in: tz("UTC") }));

/** Ids in an example name no row; "Try it out" answers `404` until a real one is pasted. */
export const EXAMPLE_ID = {
  listing: "3f2b8c1e-6d4a-4f7b-9a2e-5c8d1b7e4a60",
  request: "9b1d4e7a-2c3f-4a8b-8e6d-1f5a7c9b3d20",
  pushDelivery: "5e7c2a9d-8b1f-4d3e-a6c4-2f9b7d1e8a35",
} as const;
