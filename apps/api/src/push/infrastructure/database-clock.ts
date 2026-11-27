import type { Prisma } from "../../generated/prisma/client";

/**
 * The database's clock, which every moment of push is written and compared by: the leases,
 * `available_at`, `last_attempt_at`, the endpoint holds. A decision taken against the API's
 * own clock instead would be off by however far the two have drifted apart. Read as epoch
 * milliseconds, so no driver has to guess the zone of a `timestamp`.
 */
export async function databaseNow(db: Prisma.TransactionClient): Promise<Date> {
  const [row] = await db.$queryRaw<{ ms: number }[]>`
    SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS ms
  `;
  if (row === undefined) throw new Error("The database returned no clock");

  return new Date(row.ms);
}
