import { Injectable } from "@nestjs/common";
import type { FailedPaymentEvent } from "@repo/contracts";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import type { Page } from "../../common/paging";
import type { SetAsideCursor } from "../../common/set-aside-cursor";
import { PrismaService } from "../../prisma/prisma.service";
import type { PaymentEvent } from "../application/ports/payment-gateway";
import { cents } from "../domain/money";

/** The webhook inbox — see `PaymentEvent` in the schema. */
@Injectable()
export class PaymentEventRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * A redelivery writes nothing rather than failing on the key. Typed by the schema, so a
   * `PaymentEvent` kind that `findUnprocessed` could not read back stops compiling where it is recorded.
   */
  async record(event: z.output<typeof paymentEventSchema>): Promise<void> {
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

  /**
   * The events set aside, newest first, over the partial `payment_events_failed_idx`. The
   * cursor's key is said twice for the reason `afterCursor` in `listing.repository.ts` gives.
   */
  async findFailedPage(
    cursor: SetAsideCursor | null,
    limit: number,
  ): Promise<Page<FailedPaymentEvent>> {
    const rows = await this.prismaService.paymentEvent.findMany({
      where: {
        failedAt: cursor === null ? { not: null } : { lte: cursor.at },
        ...(cursor === null
          ? {}
          : {
              OR: [
                { failedAt: { lt: cursor.at } },
                { failedAt: cursor.at, id: { lt: cursor.id } },
              ],
            }),
      },
      select: {
        id: true,
        type: true,
        attempts: true,
        lastError: true,
        receivedAt: true,
        failedAt: true,
      },
      orderBy: [{ failedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    return {
      items: rows.slice(0, limit).flatMap((row) =>
        row.failedAt === null
          ? []
          : [
              {
                id: row.id,
                type: row.type,
                attempts: row.attempts,
                lastError: row.lastError,
                receivedAt: row.receivedAt.toISOString(),
                failedAt: row.failedAt.toISOString(),
              },
            ],
      ),
      hasMore: rows.length > limit,
    };
  }

  /**
   * Hands a set-aside event back to the worker: `failed_at` and `attempts` cleared, so it
   * gets the whole count again. `false` for an event that is not set aside — or not there.
   */
  async handBack(eventId: string): Promise<boolean> {
    const { count } = await this.prismaService.paymentEvent.updateMany({
      where: { id: eventId, processedAt: null, failedAt: { not: null } },
      data: { failedAt: null, attempts: 0 },
    });

    return count > 0;
  }

  async exists(eventId: string): Promise<boolean> {
    return (
      (await this.prismaService.paymentEvent.count({
        where: { id: eventId },
      })) > 0
    );
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

/** An amount as the payload stores it, in cents like every amount; `cents` refuses a fraction. */
const storedAmount = z.int().transform(cents);

/** Nothing in the database holds `payload` to its type, so it is parsed on the way out. */
const paymentEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("succeeded"),
    eventId: z.string(),
    type: z.string(),
    paymentId: z.string(),
    chargeId: z.string().nullable(),
    bookingId: z.string().nullable(),
    amount: storedAmount,
  }),
  z.object({
    kind: z.literal("refunded"),
    eventId: z.string(),
    type: z.string(),
    paymentId: z.string(),
    chargeId: z.string(),
    amountRefunded: storedAmount,
  }),
  z.object({
    kind: z.literal("refundFailed"),
    eventId: z.string(),
    type: z.string(),
    paymentId: z.string(),
    refundId: z.string(),
    amount: storedAmount,
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
