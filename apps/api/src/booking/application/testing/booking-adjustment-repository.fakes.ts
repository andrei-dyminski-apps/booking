import { randomUUID } from "node:crypto";
import type { BookingAdjustment, RefundFailureStatus } from "@repo/contracts";
import type { PublicOf } from "../../../common/testing/public-of.fakes";
import type { Cents, Currency } from "../../../payment/domain/money";
import type { AdminStanding, RecordedPress } from "../../domain/booking.types";
import type {
  AdjustmentClaim,
  BookingAdjustmentRepository,
  NewAdjustment,
} from "../../infrastructure/booking-adjustment.repository";

/** A row of `booking_adjustments`; `refundId` is `null` while the press is only claimed. */
export type FakeAdjustmentRow = {
  id: string;
  bookingId: string;
  adminId: string;
  requestId: string;
  amountCents: Cents;
  currency: Currency;
  reason: string;
  refundId: string | null;
  /** When the provider was last asked for the press. */
  attemptedAt: string;
  createdAt: string;
};

/**
 * `booking_adjustments` by press, as the unique `(booking_id, request_id)` keeps it: a claim,
 * completed by `record`, and a completed row is never written again. Every caller is an
 * active admin until `standing` says otherwise, and no refund was sent back until `bounces`
 * names it.
 */
export class FakeBookingAdjustmentRepository implements PublicOf<BookingAdjustmentRepository> {
  /** In the order they were written. */
  readonly rows: FakeAdjustmentRow[] = [];

  /** What `adminStanding` answers for every account. */
  standing: AdminStanding = "ACTIVE";

  /** The refunds the bank sent back, by the refund's id — `refund_failures` as it is read. */
  readonly bounces = new Map<string, RefundFailureStatus>();

  find(bookingId: string, requestId: string): Promise<RecordedPress | null> {
    const row = this.rowOf(bookingId, requestId);

    if (row === undefined) return Promise.resolve(null);

    return Promise.resolve(
      row.refundId === null
        ? {
            status: "CLAIMED",
            amountCents: row.amountCents,
            attemptedAt: new Date(row.attemptedAt),
          }
        : { status: "SENT", adjustment: this.toAdjustment(row) },
    );
  }

  listOf(bookingId: string): Promise<BookingAdjustment[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => row.bookingId === bookingId)
        .map((row) => this.toAdjustment(row))
        .reverse(),
    );
  }

  adminStanding(): Promise<AdminStanding> {
    return Promise.resolve(this.standing);
  }

  claim(claim: AdjustmentClaim): Promise<void> {
    if (this.rowOf(claim.bookingId, claim.requestId) !== undefined) {
      return Promise.reject(new Error("The press is claimed already"));
    }

    const now = new Date().toISOString();

    this.rows.push({
      ...claim,
      id: randomUUID(),
      refundId: null,
      attemptedAt: now,
      createdAt: now,
    });

    return Promise.resolve();
  }

  markAttempt(bookingId: string, requestId: string): Promise<void> {
    const row = this.rowOf(bookingId, requestId);

    if (row !== undefined && row.refundId === null) {
      row.attemptedAt = new Date().toISOString();
    }

    return Promise.resolve();
  }

  record(adjustment: NewAdjustment): Promise<BookingAdjustment> {
    const { bookingId, requestId, refundId, amountCents } = adjustment;
    const existing = this.rowOf(bookingId, requestId);

    if (existing === undefined) {
      const now = new Date().toISOString();
      const row = {
        ...adjustment,
        id: randomUUID(),
        attemptedAt: now,
        createdAt: now,
      };

      this.rows.push(row);

      return Promise.resolve(this.toAdjustment(row));
    }

    existing.refundId = refundId;
    existing.amountCents = amountCents;

    return Promise.resolve(this.toAdjustment(existing));
  }

  release(bookingId: string, requestId: string): Promise<void> {
    const index = this.rows.findIndex(
      (row) =>
        row.bookingId === bookingId &&
        row.requestId === requestId &&
        row.refundId === null,
    );

    if (index !== -1) this.rows.splice(index, 1);

    return Promise.resolve();
  }

  private toAdjustment(row: FakeAdjustmentRow): BookingAdjustment {
    return {
      id: row.id,
      bookingId: row.bookingId,
      requestId: row.requestId,
      amountCents: row.amountCents,
      currency: row.currency,
      reason: row.reason,
      refundId: row.refundId,
      bounce:
        row.refundId === null ? null : (this.bounces.get(row.refundId) ?? null),
      admin: { id: row.adminId, name: "Admin" },
      createdAt: row.createdAt,
    };
  }

  private rowOf(
    bookingId: string,
    requestId: string,
  ): FakeAdjustmentRow | undefined {
    return this.rows.find(
      (row) => row.bookingId === bookingId && row.requestId === requestId,
    );
  }
}
