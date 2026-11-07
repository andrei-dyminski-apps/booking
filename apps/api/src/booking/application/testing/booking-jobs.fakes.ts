import type { BookingJobs } from "../ports/booking-jobs";
import type { PublicOf } from "./booking-fixtures.fakes";

/**
 * `runAt` is taken as an argument rather than ignored, because that is the only thing the
 * service decides about the deadline: it forwards the one the repository wrote. A fake
 * with the shorter signature stays assignable (see `PublicOf` above), so nothing but this
 * would notice a service that scheduled the job for the wrong moment — or for `now`.
 */
export class FakeBookingJobs implements PublicOf<BookingJobs> {
  readonly scheduled: { bookingId: string; runAt: Date }[] = [];
  readonly cancelled: string[] = [];
  /** The payments queued for withdrawal; the job that withdraws them is `withdrawPayment`. */
  readonly withdrawals: string[] = [];

  scheduleExpiry(bookingId: string, runAt: Date): Promise<void> {
    this.scheduled.push({ bookingId, runAt });

    return Promise.resolve();
  }

  cancelExpiry(bookingId: string): Promise<void> {
    this.cancelled.push(bookingId);

    return Promise.resolve();
  }

  withdrawPayment(paymentId: string): Promise<void> {
    this.withdrawals.push(paymentId);

    return Promise.resolve();
  }

  /** The cancellations whose refund was queued. */
  readonly refunds: string[] = [];

  /** What a refund job failed with; the request that queued it never hears of it. */
  readonly failedRefunds: unknown[] = [];

  /**
   * The worker, run at once as if it had picked the job up: most specs are about what a
   * cancellation ends up refunding, not about when. `null` leaves the job waiting.
   */
  worker: ((bookingId: string) => Promise<unknown>) | null = null;

  async refundCancellation(bookingId: string): Promise<void> {
    this.refunds.push(bookingId);

    try {
      await this.worker?.(bookingId);
    } catch (error) {
      this.failedRefunds.push(error);
    }
  }
}
