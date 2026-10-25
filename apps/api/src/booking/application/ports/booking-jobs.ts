/**
 * The work the stays leave for later — the port `BookingService` schedules it through, so
 * the application layer names no queue. `BookingExpiryQueue` is the adapter. An abstract
 * class, so the class itself is the DI token, the way `PaymentGateway` is.
 *
 * None of the four may fail the caller: each is called after a write has committed, and
 * a sweep finds whatever a lost job would have done.
 */
export abstract class BookingJobs {
  /** Releases the hold at its deadline. */
  abstract scheduleExpiry(bookingId: string, runAt: Date): Promise<void>;

  /** Drops the release of a hold that no longer needs one; best effort. */
  abstract cancelExpiry(bookingId: string): Promise<void>;

  /** Withdraws the payment of a hold that was released or cancelled. */
  abstract withdrawPayment(paymentId: string): Promise<void>;

  /** Sends the refund a cancellation owes. */
  abstract refundCancellation(bookingId: string): Promise<void>;
}
