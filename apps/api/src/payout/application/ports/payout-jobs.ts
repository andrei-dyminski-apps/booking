/** Neither call fails the caller: the hourly sweep pays what a lost job would have. */
export abstract class PayoutJobs {
  abstract schedulePayout(bookingId: string, runAt: Date): Promise<void>;

  abstract schedulePayoutsOf(hostId: string): Promise<void>;
}
