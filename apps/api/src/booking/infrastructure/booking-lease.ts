import { Prisma } from "../../generated/prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";

/** The leases a booking row carries, one column each. */
export type LeaseColumn = "cancelling_until" | "settling_until";

export type LeaseTiming = {
  /** How long a holder keeps the row before anybody else may take it. */
  leaseMs: number;
  /** How long a caller waits for somebody else's lease before giving up. */
  waitMs: number;
  /** The first pause between two tries, doubled up to `pollMaxMs`. */
  pollMs: number;
  pollMaxMs: number;
};

/** Somebody else held the lease for longer than the caller was willing to wait. */
export class LeaseBusyError extends Error {
  constructor(id: string, column: LeaseColumn) {
    super(`Booking ${id} is held by another run (${column})`);
    this.name = "LeaseBusyError";
  }
}

/**
 * Runs `work` while holding a lease on one booking row: a column that says until when the
 * row is taken. A lease rather than a lock an open transaction holds, because the work
 * calls Stripe — a transaction kept open across that pins a pool connection per caller,
 * and a slow provider then starves every other request. A holder that dies frees the row
 * when its lease runs out.
 *
 * The deadline is the database's clock, not this process's: several instances with clocks
 * apart would otherwise each read a lease as expired at a different moment. The token a
 * holder lets go with is the deadline as Postgres spells it, so a lease this run outlived
 * and somebody else took since is left alone.
 *
 * A booking that does not exist is not waited for — the work is what answers it.
 */
export async function whileLeased<T>(
  prismaService: PrismaService,
  column: LeaseColumn,
  id: string,
  timing: LeaseTiming,
  work: () => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + timing.waitMs;
  let pause = timing.pollMs;
  let token = await takeLease(prismaService, column, id, timing.leaseMs);

  if (token === null && !(await exists(prismaService, id))) return work();

  while (token === null) {
    if (Date.now() >= deadline) {
      if (!(await exists(prismaService, id))) return work();

      throw new LeaseBusyError(id, column);
    }

    await new Promise((resolve) => setTimeout(resolve, pause));
    pause = Math.min(pause * 2, timing.pollMaxMs);
    token = await takeLease(prismaService, column, id, timing.leaseMs);
  }

  try {
    return await work();
  } finally {
    await prismaService.$executeRaw`
      UPDATE bookings SET ${Prisma.raw(column)} = NULL
      WHERE id = ${id}::uuid AND ${Prisma.raw(column)} = ${token}::timestamp
    `;
  }
}

/** The lease's token when nobody holds one that is still running; `null` otherwise. */
async function takeLease(
  prismaService: PrismaService,
  column: LeaseColumn,
  id: string,
  leaseMs: number,
): Promise<string | null> {
  // The columns are `timestamp` without a zone holding UTC, the way Prisma writes them.
  const rows = await prismaService.$queryRaw<{ token: string }[]>`
    UPDATE bookings
    SET ${Prisma.raw(column)} = (now() AT TIME ZONE 'UTC') + ${leaseMs} * INTERVAL '1 millisecond'
    WHERE id = ${id}::uuid
      AND (${Prisma.raw(column)} IS NULL OR ${Prisma.raw(column)} <= (now() AT TIME ZONE 'UTC'))
    RETURNING ${Prisma.raw(column)}::text AS token
  `;

  return rows[0]?.token ?? null;
}

async function exists(
  prismaService: PrismaService,
  id: string,
): Promise<boolean> {
  const row = await prismaService.booking.findUnique({
    where: { id },
    select: { id: true },
  });

  return row !== null;
}
