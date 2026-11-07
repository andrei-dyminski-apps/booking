import type { PublicOf } from "../../../common/testing/public-of.fakes";
import type { PayoutJobs } from "../ports/payout-jobs";

/** What was queued, for whom and when; the queue itself is `host-payout.queue.ts`'s. */
export class FakePayoutJobs implements PublicOf<PayoutJobs> {
  readonly scheduled: { bookingId: string; runAt: Date }[] = [];
  readonly hosts: string[] = [];

  schedulePayoutsOf(hostId: string): Promise<void> {
    this.hosts.push(hostId);

    return Promise.resolve();
  }

  schedulePayout(bookingId: string, runAt: Date): Promise<void> {
    this.scheduled.push({ bookingId, runAt });

    return Promise.resolve();
  }
}
