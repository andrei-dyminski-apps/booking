import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { PaymentEvent } from "../application/ports/payment-gateway";

/** The webhook inbox — see `PaymentEvent` in the schema. */
@Injectable()
export class PaymentEventRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /** A redelivery writes nothing rather than failing on the key. */
  async record(event: PaymentEvent): Promise<void> {
    await this.prismaService.paymentEvent.createMany({
      data: [{ id: event.eventId, type: event.type, payload: event }],
      skipDuplicates: true,
    });
  }

  /** `null` when processed, set aside or never recorded. An unreadable payload throws. */
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
   * Counts a failed run and sets the event aside at `maxAttempts`. Two conditional steps, so
   * of two runs failing at once only one reports it. `null` for an event no longer pending.
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

  /** The oldest pending events that arrived before `before`. */
  async findStale(before: Date, limit: number): Promise<string[]> {
    const rows = await this.prismaService.paymentEvent.findMany({
      where: { ...STILL_PENDING, receivedAt: { lte: before } },
      select: { id: true },
      orderBy: { receivedAt: "asc" },
      take: limit,
    });

    return rows.map(({ id }) => id);
  }

  /** An event set aside is never processed, so it stays until a person deals with it. */
  async pruneProcessed(before: Date): Promise<number> {
    const { count } = await this.prismaService.paymentEvent.deleteMany({
      where: { processedAt: { lt: before } },
    });

    return count;
  }
}

/** Neither handled nor given up on. */
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
