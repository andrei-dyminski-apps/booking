import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../../prisma/prisma.service";
import type { PaymentEvent } from "../application/ports/payment-gateway";

/**
 * The inbox of the provider's webhook deliveries — see `PaymentEvent` in the schema: a
 * delivery is recorded, read back by the worker that handles it, and stamped processed.
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

  /** The event to handle, or `null` when it is processed already or was never recorded. */
  async findUnprocessed(eventId: string): Promise<PaymentEvent | null> {
    const row = await this.prismaService.paymentEvent.findFirst({
      where: { id: eventId, processedAt: null },
      select: { payload: true },
    });

    return row === null ? null : paymentEventSchema.parse(row.payload);
  }

  async markProcessed(eventId: string): Promise<void> {
    await this.prismaService.paymentEvent.updateMany({
      where: { id: eventId, processedAt: null },
      data: { processedAt: new Date() },
    });
  }

  /** The events still unprocessed that arrived before `before` — what a lost job left. */
  async findStale(before: Date): Promise<string[]> {
    const rows = await this.prismaService.paymentEvent.findMany({
      where: { processedAt: null, receivedAt: { lte: before } },
      select: { id: true },
      orderBy: { receivedAt: "asc" },
    });

    return rows.map(({ id }) => id);
  }
}

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
