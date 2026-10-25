import { Logger } from "@nestjs/common";
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
 * **The lease is renewed while the work runs**, every third of `leaseMs`, so work that
 * outlasts one lease — Stripe slow on every call of a refund — still holds the row: only a
 * holder that stopped renewing loses it, which is a process that died or froze. A renewal
 * is conditional on the token, so one that finds the lease taken records the loss instead
 * of taking it back, and the run reports it once its work is over: what it wrote after the
 * loss was written beside another holder, and the conditional writes and the idempotency
 * keys under every lease are what kept that safe.
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
      await prismaService.$executeRaw`
        UPDATE bookings SET ${Prisma.raw(column)} = NULL
        WHERE id = ${id}::uuid AND ${Prisma.raw(column)} = ${held.token}::timestamp
      `;
    }
  }
}

const logger = new Logger("BookingLease");

/**
 * Pushes the deadline of a lease this run still holds, and moves the token to the new one.
 * A lease somebody else took — this one ran out before the renewal came — is left alone and
 * marked lost. A renewal that fails outright is logged and tried again by the next beat.
 */
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
