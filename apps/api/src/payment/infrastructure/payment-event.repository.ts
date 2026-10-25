import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { PaymentEvent } from "../application/ports/payment-gateway";

/**
 * The inbox of the provider's webhook deliveries — see `PaymentEvent` in the schema: a
 * delivery is recorded, read back by the worker that handles it, and stamped processed —
 * or, after failing too often, set aside.
 */
@Injectable()
export class PaymentEventRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Written by the webhook before it answers. A redelivery of an event already here writes
   * nothing — `skipDuplicates` rather than a failure on the key.
   */
  async record(event: PaymentEvent): Promise<void> {
    await this.prismaService.paymentEvent.createMany({
      data: [{ id: event.eventId, type: event.type, payload: event }],
      skipDuplicates: true,
    });
  }

  /**
   * The event to handle, or `null` when it is processed already, set aside, or was never
   * recorded. A payload the schema cannot read throws, and counts as a failed run.
   */
  async findUnprocessed(eventId: string): Promise<PaymentEvent | null> {
    const row = await this.prismaService.paymentEvent.findFirst({
      where: { id: eventId, ...STILL_PENDING },
      select: { payload: true },
    });

    return row === null ? null : paymentEventSchema.parse(row.payload);
  }

  async markProcessed(eventId: string): Promise<void> {
    await this.prismaService.paymentEvent.updateMany({
      where: { id: eventId, ...STILL_PENDING },
      data: { processedAt: new Date() },
    });
  }

  /**
   * Counts a failed run, and sets the event aside once it has failed `maxAttempts` times.
   * Two steps, each conditional: of two runs failing at once only the one whose write set
   * the event aside reports it (`setAside`), so the admins are told once. `null` for an
   * event no longer pending — processed or set aside by a run racing this one.
   */
  async recordFailure(
    eventId: string,
    error: string,
    maxAttempts: number,
  ): Promise<{ type: string; attempts: number; setAside: boolean } | null> {
    const [counted] = await this.prismaService.paymentEvent.updateManyAndReturn(
      {
        where: { id: eventId, ...STILL_PENDING },
        data: { attempts: { increment: 1 }, lastError: error },
        select: { type: true, attempts: true },
      },
    );

    if (counted === undefined) return null;

    if (counted.attempts < maxAttempts) return { ...counted, setAside: false };

    const { count } = await this.prismaService.paymentEvent.updateMany({
      where: { id: eventId, ...STILL_PENDING },
      data: { failedAt: new Date() },
    });

    return { ...counted, setAside: count > 0 };
  }

  /**
   * The oldest of the events still pending that arrived before `before` — what a lost job
   * left — at most `limit` of them; the sweep after this one reads the rest.
   */
  async findStale(before: Date, limit: number): Promise<string[]> {
    const rows = await this.prismaService.paymentEvent.findMany({
      where: { ...STILL_PENDING, receivedAt: { lte: before } },
      select: { id: true },
      orderBy: { receivedAt: "asc" },
      take: limit,
    });

    return rows.map(({ id }) => id);
  }

  /**
   * Deletes the events processed before `before`. The provider redelivers an event for
   * three days at most, so a row older than the retention has nothing left to deduplicate;
   * an event set aside is never processed and stays until a person deals with it.
   */
  async pruneProcessed(before: Date): Promise<number> {
    const { count } = await this.prismaService.paymentEvent.deleteMany({
      where: { processedAt: { lt: before } },
    });

    return count;
  }
}

/** Neither handled nor given up on — what the worker and the sweep look for. */
const STILL_PENDING = {
  processedAt: null,
  failedAt: null,
} satisfies Prisma.PaymentEventWhereInput;

/** Nothing in the database holds `payload` to its type, so it is parsed on the way out. */
const paymentEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("succeeded"),
    eventId: z.string(),
    type: z.string(),
    paymentId: z.string(),
    chargeId: z.string().nullable(),
    bookingId: z.string().nullable(),
    amount: z.number(),
  }),
  z.object({
    kind: z.literal("refunded"),
    eventId: z.string(),
    type: z.string(),
    paymentId: z.string(),
    chargeId: z.string(),
    amountRefunded: z.number(),
  }),
  z.object({
    kind: z.literal("refundFailed"),
    eventId: z.string(),
    type: z.string(),
    paymentId: z.string(),
    refundId: z.string(),
    amount: z.number(),
    reason: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("disputed"),
    eventId: z.string(),
    type: z.string(),
    paymentId: z.string(),
  }),
  z.object({
    kind: z.literal("disputeClosed"),
    eventId: z.string(),
    type: z.string(),
    paymentId: z.string(),
    won: z.boolean(),
  }),
  z.object({
    kind: z.literal("account"),
    eventId: z.string(),
    type: z.string(),
    accountId: z.string().nullable(),
  }),
  z.object({ kind: z.literal("other"), eventId: z.string(), type: z.string() }),
]) satisfies z.ZodType<PaymentEvent>;
