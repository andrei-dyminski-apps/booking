import { randomUUID } from "node:crypto";
import { BookingStatus } from "@repo/contracts";
import type { Cents } from "../../../payment/domain/money";
import { CancellationInProgressError } from "../../domain/booking.errors";
import type { CancellationBy, CancelledStay } from "../../domain/booking.types";
import type { BookingCancellationRepository } from "../../infrastructure/booking-cancellation.repository";
import { isActive, type PublicOf } from "./booking-fixtures.fakes";
import type { FakeBookingTable } from "./booking-table.fakes";

/**
 * Cancels only an active row still in the status the refund was decided by, as the `where`
 * of `cancel` does, and holds one lease per booking at a time.
 */
export class FakeBookingCancellationRepository implements PublicOf<BookingCancellationRepository> {
  constructor(private readonly table: FakeBookingTable) {}

  /** The bookings whose cancellation lease another run holds past the wait. */
  readonly held = new Set<string>();

  /** The fees the host's cancellations wrote, by booking; `waived` as an admin left it. */
  readonly hostFees = new Map<
    string,
    { id: string; hostId: string; amountCents: Cents; waived?: boolean }
  >();

  async cancel(
    id: string,
    status: BookingStatus,
    refundOwedCents: Cents | null,
    by: CancellationBy | null = null,
  ): Promise<CancelledStay | null> {
    await this.table.racing?.(id);

    const found = this.table.rows.get(id);

    if (
      found === undefined ||
      !isActive(found.booking) ||
      found.booking.status !== status
    ) {
      return null;
    }

    found.booking.status = BookingStatus.CANCELLED;
    found.booking.refundOwedCents = refundOwedCents;

    if (by !== null) {
      found.booking.cancelledBy = by.canceller;
      found.booking.cancelledAt = new Date().toISOString();
      found.booking.cancellationReason = by.reason;
    }

    const fee =
      by?.feeCents == null
        ? null
        : {
            id: randomUUID(),
            hostId: found.listingOwnerId,
            amountCents: by.feeCents,
          };

    if (fee !== null) this.hostFees.set(id, fee);

    return {
      paymentId: found.paymentId,
      fee: fee === null ? null : { id: fee.id, amountCents: fee.amountCents },
    };
  }

  /** Every fee of the host not waived counts: the fake keeps no clock. */
  hostCancellations(
    hostId: string,
  ): Promise<{ name: string; cancellations: number } | null> {
    return Promise.resolve({
      name: "Host",
      cancellations: [...this.hostFees.values()].filter(
        (fee) => fee.hostId === hostId && fee.waived !== true,
      ).length,
    });
  }

  /** One holder per booking at a time, the rest queued behind it as the lease makes them. */
  private readonly cancelling = new Map<string, Promise<unknown>>();

  /** The bookings a lease was taken for, in order. */
  readonly leases: string[] = [];

  whileCancelling<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (this.held.has(id)) {
      return Promise.reject(new CancellationInProgressError(id));
    }

    this.leases.push(id);

    const previous = this.cancelling.get(id) ?? Promise.resolve();
    const next = previous.then(work, work);

    this.cancelling.set(
      id,
      next.catch(() => undefined),
    );

    return next;
  }
}
