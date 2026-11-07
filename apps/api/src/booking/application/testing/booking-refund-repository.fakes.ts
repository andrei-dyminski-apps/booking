import type { StuckKind } from "@repo/contracts";
import type { SetAside } from "../../../common/job-failure";
import type { Page } from "../../../common/paging";
import type { SetAsideCursor } from "../../../common/set-aside-cursor";
import { NO_CENTS, type Cents } from "../../../payment/domain/money";
import type {
  BookingWithListingOwner,
  RefundTarget,
  StuckStayRow,
} from "../../domain/booking.types";
import type { BookingRefundRepository } from "../../infrastructure/booking-refund.repository";
import { compare, type PublicOf } from "./booking-fixtures.fakes";
import { holdOf, type FakeBookingTable } from "./booking-table.fakes";

/** The refunds owed on the shared table, how often each failed, and the provider's news. */
export class FakeBookingRefundRepository implements PublicOf<BookingRefundRepository> {
  constructor(private readonly table: FakeBookingTable) {}

  /** The failed runs of an owed refund by booking, and when it was set aside. */
  readonly refundFailures = new Map<
    string,
    { attempts: number; setAside: boolean; setAsideAt?: Date }
  >();

  /** The fewest failures first, leaving out what was set aside or waits on a dispute. */
  findOwedRefunds(limit: number): Promise<string[]> {
    const attemptsOf = (id: string) =>
      this.refundFailures.get(id)?.attempts ?? 0;

    return Promise.resolve(
      [...this.table.rows.values()]
        .filter(
          ({ booking }) =>
            booking.refundOwedCents !== null &&
            booking.dispute !== "OPEN" &&
            this.refundFailures.get(booking.id)?.setAside !== true,
        )
        .map(({ booking }) => booking.id)
        .sort((left, right) => attemptsOf(left) - attemptsOf(right))
        .slice(0, limit),
    );
  }

  recordRefundFailure(
    id: string,
    _error: string,
    maxAttempts: number,
  ): Promise<SetAside | null> {
    const failure = this.refundFailures.get(id) ?? {
      attempts: 0,
      setAside: false,
    };

    if (
      this.table.rows.get(id)?.booking.refundOwedCents == null ||
      failure.setAside
    ) {
      return Promise.resolve(null);
    }

    failure.attempts += 1;
    failure.setAside = failure.attempts >= maxAttempts;
    if (failure.setAside) failure.setAsideAt = this.tick();
    this.refundFailures.set(id, failure);

    return Promise.resolve({
      attempts: failure.attempts,
      setAside: failure.setAside,
    });
  }

  /** A distinct moment per call, so a list ordered by when rows were set aside has an order. */
  private clock = Date.parse("2026-10-25T12:00:00.000Z");

  private tick(): Date {
    this.clock += 1_000;

    return new Date(this.clock);
  }

  /**
   * The set-aside debts, newest first. A payout is never stuck here: the payout's columns
   * are `payout.service.spec.ts`'s, and what `GET /bookings/stuck` reads of them is e2e's.
   */
  findStuckPage(
    kind: StuckKind,
    cursor: SetAsideCursor | null,
    limit: number,
  ): Promise<Page<StuckStayRow>> {
    const stuck = [...this.table.rows.values()]
      .flatMap((found) => {
        const failure = this.refundFailures.get(found.booking.id);

        return kind === "refund" &&
          failure?.setAsideAt !== undefined &&
          found.booking.refundOwedCents !== null
          ? [
              {
                kind,
                booking: found.booking,
                attempts: failure.attempts,
                lastError: "refused",
                failedAt: failure.setAsideAt.toISOString(),
                payout: null,
              },
            ]
          : [];
      })
      .sort((left, right) => compare(right.failedAt, left.failedAt));
    const start =
      cursor === null
        ? 0
        : stuck.findIndex((row) => row.booking.id === cursor.id) + 1;

    return Promise.resolve({
      items: stuck.slice(start, start + limit),
      hasMore: stuck.length > start + limit,
    });
  }

  handBackRefund(id: string): Promise<boolean> {
    const failure = this.refundFailures.get(id);

    if (
      failure?.setAside !== true ||
      this.table.rows.get(id)?.booking.refundOwedCents == null
    ) {
      return Promise.resolve(false);
    }

    this.refundFailures.delete(id);

    return Promise.resolve(true);
  }

  /** The total only upwards, and the debt cleared with it. */
  settleOwedRefund(id: string, total: Cents | null): Promise<void> {
    const found = this.table.rows.get(id);

    if (found === undefined) return Promise.resolve();

    if (
      total !== null &&
      (found.booking.refundedAmountCents ?? NO_CENTS) < total
    ) {
      found.booking.refundedAmountCents = total;
    }

    found.booking.refundOwedCents = null;
    this.refundFailures.delete(id);

    return Promise.resolve();
  }

  findPaymentTarget(id: string): Promise<RefundTarget | null> {
    const found = this.table.rows.get(id);

    return Promise.resolve(
      found === undefined ? null : this.refundTargetOf(found),
    );
  }

  findRefundTarget(paymentId: string): Promise<RefundTarget | null> {
    const found = [...this.table.rows.values()].find(
      (row) => row.paymentId === paymentId,
    );

    return Promise.resolve(
      found === undefined ? null : this.refundTargetOf(found),
    );
  }

  private refundTargetOf(found: BookingWithListingOwner): RefundTarget {
    const { amountCents, currency, refundedAmountCents, refundOwedCents } =
      found.booking;

    return {
      amountCents,
      currency,
      refundedAmountCents,
      refundOwedCents,
      bookingId: found.booking.id,
      status: found.booking.status,
      paid: found.booking.paid,
      confirmationAnnounced: this.table.announced.has(found.booking.id),
      hold: holdOf(found),
    };
  }

  /** Only upwards and only for a paid stay, from exactly what the caller read. */
  raiseRefunded(id: string, from: Cents | null, to: Cents): Promise<boolean> {
    const found = this.table.rows.get(id);

    if (
      found === undefined ||
      !found.booking.paid ||
      found.booking.refundedAmountCents !== from
    ) {
      return Promise.resolve(false);
    }

    found.booking.refundedAmountCents = to;

    return Promise.resolve(true);
  }

  recordRefund(id: string, amount: Cents): Promise<boolean> {
    const found = this.table.rows.get(id);

    if (found === undefined || found.booking.refundedAmountCents !== null) {
      return Promise.resolve(false);
    }

    found.booking.refundedAmountCents = amount;

    return Promise.resolve(true);
  }
}
