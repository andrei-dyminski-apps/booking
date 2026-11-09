import { Injectable } from "@nestjs/common";
import type { StuckKind, StuckStayQuery } from "@repo/contracts";
import type { Prisma } from "../../generated/prisma/client";
import type { SetAside } from "../../common/job-failure";
import type { Page } from "../../common/paging";
import type { SetAsideCursor } from "../../common/set-aside-cursor";
import { setAsideWithin } from "../../common/set-aside-window";
import { PrismaService } from "../../prisma/prisma.service";
import {
  cents,
  NO_CENTS,
  subtractCents,
  type Cents,
} from "../../payment/domain/money";
import type { RefundTarget, StuckStayRow } from "../domain/booking.types";
import { hostFeesKey, shareOutHostFees } from "../domain/stuck-stay";
import { owedFeesWhere, stuckPayout } from "./booking-where";
import {
  BOOKING_INCLUDE,
  nullableCentsOf,
  RELEASED_HOLD_INCLUDE,
  toBooking,
  toRefundTarget,
  toStayMoney,
} from "./stay-rows";

/** What the admin's list of stuck stays narrows by, past its kind. */
export type StuckStayFilters = Pick<
  StuckStayQuery,
  "bookingId" | "listingId" | "guestId" | "hostId" | "from" | "to"
>;

/**
 * The money that goes back to a guest: the refund a cancellation or an early end owes and
 * the sweep that pays it, the admin's list of what was set aside, and what the provider's
 * news about a payment and its refunds reads and writes. The cancellation lease they run
 * under is `BookingCancellationRepository.whileCancelling`.
 */
@Injectable()
export class BookingRefundRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * The debts still owed, the fewest failures first. A stay under a running lease is left
   * to its holder, and one under an open dispute to the outcome. Raw SQL, because the lease
   * is compared on the database's clock, which Prisma's `where` cannot name.
   */
  async findOwedRefunds(limit: number): Promise<string[]> {
    const rows = await this.prismaService.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM bookings
      WHERE refund_owed_cents IS NOT NULL
        AND refund_failed_at IS NULL
        AND dispute_status IS DISTINCT FROM 'OPEN'
        AND (cancelling_until IS NULL OR cancelling_until <= (now() AT TIME ZONE 'UTC'))
      ORDER BY refund_attempts, id
      LIMIT ${limit}
    `;

    return rows.map(({ id }) => id);
  }

  /**
   * The stays whose owed refund or host payout was set aside, newest first. Each kind reads
   * its own partial index (`bookings_refund_failed_idx`, `bookings_payout_failed_idx`); the
   * payout's columns are `PayoutRepository`'s to write, and only read here, because the
   * row a stay is answered with is this repository's mapping.
   */
  async findStuckPage(
    kind: StuckKind,
    cursor: SetAsideCursor | null,
    limit: number,
    filters: StuckStayFilters,
  ): Promise<Page<StuckStayRow>> {
    const isRefund = kind === "refund";
    const column = isRefund ? "refundFailedAt" : "payoutFailedAt";
    const after: Prisma.BookingWhereInput =
      cursor === null
        ? {}
        : {
            [column]: { lte: cursor.at },
            OR: [
              { [column]: { lt: cursor.at } },
              { [column]: cursor.at, id: { lt: cursor.id } },
            ],
          };
    const rows = await this.prismaService.booking.findMany({
      where: {
        AND: [
          isRefund
            ? STUCK_REFUND
            : stuckPayout(this.prismaService.booking.fields),
          {
            id: filters.bookingId,
            listingId: filters.listingId,
            guestId: filters.guestId,
            [column]: setAsideWithin(filters),
            ...(filters.hostId === undefined
              ? {}
              : { listing: { ownerId: filters.hostId } }),
          },
          after,
        ],
      },
      include: BOOKING_INCLUDE,
      orderBy: [{ [column]: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const feesLeft = isRefund
      ? new Map<string, Cents>()
      : await this.feesLeftFor(page.map((row) => row.listing.ownerId));

    return {
      items: page.flatMap((row) => {
        const { failedAt, attempts, lastError } = isRefund
          ? {
              failedAt: row.refundFailedAt,
              attempts: row.refundAttempts,
              lastError: row.refundLastError,
            }
          : {
              failedAt: row.payoutFailedAt,
              attempts: row.payoutAttempts,
              lastError: row.payoutLastError,
            };

        if (failedAt === null) return [];

        return [
          {
            kind,
            booking: toBooking(row),
            attempts,
            lastError,
            failedAt: failedAt.toISOString(),
            payout: isRefund
              ? null
              : {
                  reservedCents: nullableCentsOf(row.payoutReservedCents),
                  feeWithheldCents: cents(row.feeWithheldCents),
                  hostFeesOwedCents: feesLeft.get(row.id) ?? NO_CENTS,
                },
          },
        ];
      }),
      hasMore: rows.length > limit,
    };
  }

  /**
   * The fees left for each stuck payout of these hosts, by `shareOutHostFees`. Every stuck
   * payout of theirs is read, not only this page's and whatever the filters, so a stay's
   * figure does not change with the page or the filters it is seen under; the set-aside rows
   * are few, and the partial index holds nothing else.
   */
  private async feesLeftFor(hostIds: string[]): Promise<Map<string, Cents>> {
    if (hostIds.length === 0) return new Map();

    const hosts = [...new Set(hostIds)];
    const [sums, stays] = await Promise.all([
      this.prismaService.hostFee.groupBy({
        by: ["hostId", "currency"],
        where: owedFeesWhere(this.prismaService, { in: hosts }),
        _sum: { amountCents: true, withheldCents: true },
      }),
      this.prismaService.booking.findMany({
        where: {
          AND: [
            stuckPayout(this.prismaService.booking.fields),
            { listing: { ownerId: { in: hosts } } },
          ],
        },
        include: { listing: { select: { ownerId: true } } },
        orderBy: [{ payoutFailedAt: "asc" }, { id: "asc" }],
      }),
    ]);

    return shareOutHostFees(
      stays.map((row) => ({
        booking: {
          ...toStayMoney(row),
          id: row.id,
          hostId: row.listing.ownerId,
          paid: row.paidAt !== null,
          dispute: row.disputeStatus,
        },
        payout: {
          reservedCents: nullableCentsOf(row.payoutReservedCents),
          feeWithheldCents: cents(row.feeWithheldCents),
        },
      })),
      new Map(
        sums.map(({ hostId, currency, _sum }) => [
          hostFeesKey(hostId, currency),
          subtractCents(
            cents(_sum.amountCents ?? 0),
            cents(_sum.withheldCents ?? 0),
          ),
        ]),
      ),
    );
  }

  /**
   * Hands a set-aside debt back to the sweep with a whole count of attempts. `false` for a
   * stay whose refund is not set aside — or that is not there.
   */
  async handBackRefund(id: string): Promise<boolean> {
    const { count } = await this.prismaService.booking.updateMany({
      where: { id, ...STUCK_REFUND },
      data: { refundFailedAt: null, refundAttempts: 0 },
    });

    return count > 0;
  }

  /**
   * Sets the debt aside at `maxAttempts`. Two conditional steps, so of two runs failing at
   * once only one reports it. `null` for a debt no longer pending.
   */
  async recordRefundFailure(
    id: string,
    error: string,
    maxAttempts: number,
  ): Promise<SetAside | null> {
    const pending = {
      id,
      refundOwedCents: { not: null },
      refundFailedAt: null,
    } satisfies Prisma.BookingWhereInput;
    const [counted] = await this.prismaService.booking.updateManyAndReturn({
      where: pending,
      data: { refundAttempts: { increment: 1 }, refundLastError: error },
      select: { refundAttempts: true },
    });

    if (counted === undefined) return null;

    if (counted.refundAttempts < maxAttempts) {
      return { attempts: counted.refundAttempts, setAside: false };
    }

    const { count } = await this.prismaService.booking.updateMany({
      where: pending,
      data: { refundFailedAt: new Date() },
    });

    return { attempts: counted.refundAttempts, setAside: count > 0 };
  }

  /**
   * One transaction, or the host's share would count the refund twice. `total` is `null`
   * when nothing went out; it only rises, so Stripe's figure from a webhook is kept.
   */
  async settleOwedRefund(id: string, total: Cents | null): Promise<void> {
    await this.prismaService.$transaction([
      ...(total === null
        ? []
        : [
            this.prismaService.booking.updateMany({
              where: {
                id,
                OR: [
                  { refundedAmountCents: null },
                  { refundedAmountCents: { lt: total } },
                ],
              },
              data: { refundedAmountCents: total },
            }),
          ]),
      this.prismaService.booking.updateMany({
        where: { id },
        data: {
          refundOwedCents: null,
          refundAttempts: 0,
          refundLastError: null,
        },
      }),
    ]);
  }

  async findPaymentTarget(id: string): Promise<RefundTarget | null> {
    return this.readRefundTarget({ id });
  }

  /** Only into an empty column, so of two runs only the one that wrote it tells the guest. */
  async recordRefund(id: string, amount: Cents): Promise<boolean> {
    const { count } = await this.prismaService.booking.updateMany({
      where: { id, refundedAmountCents: null },
      data: { refundedAmountCents: amount },
    });

    return count > 0;
  }

  async findRefundTarget(paymentId: string): Promise<RefundTarget | null> {
    return this.readRefundTarget({ paymentIntentId: paymentId });
  }

  private async readRefundTarget(
    where: Prisma.BookingWhereUniqueInput,
  ): Promise<RefundTarget | null> {
    const row = await this.prismaService.booking.findUnique({
      where,
      include: RELEASED_HOLD_INCLUDE,
    });

    return row === null ? null : toRefundTarget(row);
  }

  /** From exactly what was read, so an older event never lowers it. */
  async raiseRefunded(
    id: string,
    from: Cents | null,
    to: Cents,
  ): Promise<boolean> {
    const { count } = await this.prismaService.booking.updateMany({
      where: {
        id,
        paidAt: { not: null },
        refundedAmountCents: from,
      },
      data: { refundedAmountCents: to },
    });

    return count > 0;
  }
}

/** A debt set aside — still owed, which is what a retry hands back. */
const STUCK_REFUND = {
  refundFailedAt: { not: null },
  refundOwedCents: { not: null },
} satisfies Prisma.BookingWhereInput;
