import type { WaitlistService } from "../../../waitlist/waitlist.service";
import type { FreedNights } from "../../../waitlist/waitlist.types";

/**
 * Only `announceFreed`: what is asserted here is which nights were handed over and when.
 * Who among the waiting is told is `waitlist.service.spec.ts`'s.
 */
export class FakeWaitlistService implements Pick<
  WaitlistService,
  "announceFreed"
> {
  readonly freed: FreedNights[] = [];

  announceFreed(freed: FreedNights[]): Promise<void> {
    this.freed.push(
      ...freed.map(({ listingId, from, to }) => ({ listingId, from, to })),
    );

    return Promise.resolve();
  }
}
