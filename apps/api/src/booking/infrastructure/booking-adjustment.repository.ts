import { Injectable } from "@nestjs/common";
import {
  RefundFailureStatus,
  Role,
  type BookingAdjustment,
} from "@repo/contracts";
import type { Prisma } from "../../generated/prisma/client";
import { cents, currencySchema } from "../../payment/domain/money";
import { PrismaService } from "../../prisma/prisma.service";
import type { AdminStanding, RecordedPress } from "../domain/booking.types";

const ADJUSTMENT_INCLUDE = {
  admin: { select: { id: true, name: true } },
} satisfies Prisma.BookingAdjustmentInclude;

type AdjustmentRow = Prisma.BookingAdjustmentGetPayload<{
  include: typeof ADJUSTMENT_INCLUDE;
}>;

/** A refund the bank sent back, by the refund's id, as `refund_failures` has it. */
type Bounces = ReadonlyMap<string, BookingAdjustment["bounce"]>;

/** What `claim` writes: the press, before the provider is asked. */
export type AdjustmentClaim = Omit<
  BookingAdjustment,
  "id" | "admin" | "createdAt" | "refundId" | "bounce"
> & { adminId: string };

/** What `record` writes: a refund the provider holds already, and why it was sent. */
export type NewAdjustment = AdjustmentClaim & { refundId: string };

/**
 * `booking_adjustments`: the refunds admins sent for a stay without cancelling it. A press is
 * claimed before the provider is asked and completed with its answer, so a press whose
 * answer was lost keeps the amount it went out for. Both are listed — a claim as a refund
 * nobody can yet say went out — each beside what the bank did with it (`refund_failures`,
 * read by the refund's id; nothing ties the two tables by a key, since a refund is sent
 * back after it is recorded). The refund total on the stay is the provider's news to raise,
 * not this table's.
 */
@Injectable()
export class BookingAdjustmentRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async find(
    bookingId: string,
    requestId: string,
  ): Promise<RecordedPress | null> {
    const row = await this.prismaService.bookingAdjustment.findUnique({
      where: { bookingId_requestId: { bookingId, requestId } },
      include: ADJUSTMENT_INCLUDE,
    });

    if (row === null) return null;

    return row.refundId === null
      ? {
          status: "CLAIMED",
          amountCents: cents(row.amountCents),
          attemptedAt: row.attemptedAt,
        }
      : {
          status: "SENT",
          adjustment: toAdjustment(row, await this.bouncesOf([row])),
        };
  }

  /** Newest first — the order the stay's page lists them in — claims included. */
  async listOf(bookingId: string): Promise<BookingAdjustment[]> {
    const rows = await this.prismaService.bookingAdjustment.findMany({
      where: { bookingId },
      include: ADJUSTMENT_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const bounces = await this.bouncesOf(rows);

    return rows.map((row) => toAdjustment(row, bounces));
  }

  /**
   * The caller's account as it is now, read before anything about the stay. The role in the
   * token is not trusted for it, for the reason `HostFeeRepository.waive` gives: a write to
   * `users` outside the API changes it, and the token keeps its claim until the next refresh.
   * No lock, unlike the waiver's: no route deletes an account the row would name.
   */
  async adminStanding(userId: string): Promise<AdminStanding> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { role: true, blockedAt: true },
    });

    if (user === null) return "GONE";

    return user.role === Role.ADMIN && user.blockedAt === null
      ? "ACTIVE"
      : "NOT_ADMIN";
  }

  /**
   * The press, written before the provider is asked; the caller's lease keeps it the only one.
   * `attempted_at` is stamped on this process's clock, the one `CLAIM_SETTLE_MS` is measured
   * on, rather than left to the column's default.
   */
  async claim(claim: AdjustmentClaim): Promise<void> {
    await this.prismaService.bookingAdjustment.create({
      data: { ...claim, attemptedAt: new Date() },
    });
  }

  /** A claimed press about to be sent once more: the request now on its way is the one to wait for. */
  async markAttempt(bookingId: string, requestId: string): Promise<void> {
    await this.prismaService.bookingAdjustment.updateMany({
      where: { bookingId, requestId, refundId: null },
      data: { attemptedAt: new Date() },
    });
  }

  /**
   * The provider's answer: the press's claim completed with the refund, or the row written
   * whole for a press found sent with no claim. Whoever claimed the press stays its admin —
   * the one who decided the refund, not the one who finished it. A completed row is never
   * written again.
   */
  async record(adjustment: NewAdjustment): Promise<BookingAdjustment> {
    const { bookingId, requestId, refundId, amountCents } = adjustment;
    const row = await this.prismaService.bookingAdjustment.upsert({
      where: { bookingId_requestId: { bookingId, requestId } },
      create: adjustment,
      update: { refundId, amountCents },
      include: ADJUSTMENT_INCLUDE,
    });

    return toAdjustment(row, await this.bouncesOf([row]));
  }

  /** A claim the provider refused, or never received: nothing went out for the press. */
  async release(bookingId: string, requestId: string): Promise<void> {
    await this.prismaService.bookingAdjustment.deleteMany({
      where: { bookingId, requestId, refundId: null },
    });
  }

  private async bouncesOf(
    rows: readonly Pick<AdjustmentRow, "refundId">[],
  ): Promise<Bounces> {
    const refundIds = rows.flatMap((row) =>
      row.refundId === null ? [] : [row.refundId],
    );

    if (refundIds.length === 0) return new Map();

    const failures = await this.prismaService.refundFailure.findMany({
      where: { refundId: { in: refundIds } },
      select: { refundId: true, resolvedAt: true },
    });

    return new Map(
      failures.map((failure) => [
        failure.refundId,
        failure.resolvedAt === null
          ? RefundFailureStatus.OPEN
          : RefundFailureStatus.RESOLVED,
      ]),
    );
  }
}

function toAdjustment(row: AdjustmentRow, bounces: Bounces): BookingAdjustment {
  return {
    id: row.id,
    bookingId: row.bookingId,
    requestId: row.requestId,
    amountCents: cents(row.amountCents),
    currency: currencySchema.parse(row.currency),
    reason: row.reason,
    refundId: row.refundId,
    bounce: row.refundId === null ? null : (bounces.get(row.refundId) ?? null),
    admin: row.admin,
    createdAt: row.createdAt.toISOString(),
  };
}
