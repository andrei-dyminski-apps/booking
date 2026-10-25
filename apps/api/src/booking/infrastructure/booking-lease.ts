import { Logger } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";

export type LeaseColumn = "cancelling_until" | "settling_until";

export type LeaseTiming = {
  leaseMs: number;
  waitMs: number;
  /** Doubled up to `pollMaxMs`. */
  pollMs: number;
  pollMaxMs: number;
};

export class LeaseBusyError extends Error {
  constructor(id: string, column: LeaseColumn) {
    super(`Booking ${id} is held by another run (${column})`);
    this.name = "LeaseBusyError";
  }
}

/**
 * Runs `work` holding a lease on one booking row — a column saying until when it is taken —
 * rather than a lock an open transaction holds: the work calls Stripe, and a transaction
 * kept open across that pins a pool connection per caller.
 *
 * The deadline is the database's clock, so instances with clocks apart agree on it, and the
 * token is that deadline as Postgres spells it, so a lease taken by somebody else since is
 * left alone. It is renewed every third of `leaseMs`, so only a holder that died or froze
 * loses it; a loss is logged, and the conditional writes and idempotency keys under every
 * lease are what keep that safe.
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

  const held = { token, lost: false };
  let renewing: Promise<void> = Promise.resolve();
  const heartbeat = setInterval(
    () => {
      renewing = renewing.then(() =>
        renewLease(prismaService, column, id, timing.leaseMs, held),
      );
    },
    Math.max(1, Math.floor(timing.leaseMs / 3)),
  );

  // A pending renewal must not keep a process that is shutting down alive.
  heartbeat.unref();

  try {
    return await work();
  } finally {
    clearInterval(heartbeat);
    await renewing;

    if (held.lost) {
      logger.error(
        `Booking ${id} lost its ${column} lease while the work under it ran; another run may have held it meanwhile`,
      );
    } else {
      // Must not replace what the work answered: it has committed, and the lease runs out.
      try {
        await prismaService.$executeRaw`
          UPDATE bookings SET ${Prisma.raw(column)} = NULL
          WHERE id = ${id}::uuid AND ${Prisma.raw(column)} = ${held.token}::timestamp
        `;
      } catch (error) {
        logger.warn(
          `Could not let go of the ${column} lease of booking ${id}, it runs out on its own: ${String(error)}`,
        );
      }
    }
  }
}

const logger = new Logger("BookingLease");

/** A lease somebody else took since is marked lost; a failed renewal waits for the next beat. */
async function renewLease(
  prismaService: PrismaService,
  column: LeaseColumn,
  id: string,
  leaseMs: number,
  held: { token: string; lost: boolean },
): Promise<void> {
  if (held.lost) return;

  try {
    const rows = await prismaService.$queryRaw<{ token: string }[]>`
      UPDATE bookings
      SET ${Prisma.raw(column)} = (now() AT TIME ZONE 'UTC') + ${leaseMs} * INTERVAL '1 millisecond'
      WHERE id = ${id}::uuid AND ${Prisma.raw(column)} = ${held.token}::timestamp
      RETURNING ${Prisma.raw(column)}::text AS token
    `;
    const renewed = rows[0]?.token;

    if (renewed === undefined) {
      held.lost = true;
    } else {
      held.token = renewed;
    }
  } catch (error) {
    logger.warn(
      `Could not renew the ${column} lease of booking ${id}: ${String(error)}`,
    );
  }
}

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
