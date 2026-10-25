/**
 * None of these may fail the caller: each runs after a write has committed, and a sweep
 * finds whatever a lost job would have done.
 */
export abstract class BookingJobs {
  abstract scheduleExpiry(bookingId: string, runAt: Date): Promise<void>;

  /** Best effort. */
  abstract cancelExpiry(bookingId: string): Promise<void>;

  abstract withdrawPayment(paymentId: string): Promise<void>;

  abstract refundCancellation(bookingId: string): Promise<void>;
}
