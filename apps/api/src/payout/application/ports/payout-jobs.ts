/**
 * The payouts left for a worker — the port `PayoutService` schedules them through, so the
 * application layer names no queue. `HostPayoutQueue` is the adapter. Neither call fails
 * the caller: the hourly sweep pays what a lost job would have.
 */
export abstract class PayoutJobs {
  /** Pays the host of one stay at `runAt`. */
  abstract schedulePayout(bookingId: string, runAt: Date): Promise<void>;

  /** Pays every due stay of a host whose account has just become able to receive them. */
  abstract schedulePayoutsOf(hostId: string): Promise<void>;
}
