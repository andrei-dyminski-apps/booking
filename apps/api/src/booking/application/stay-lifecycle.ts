import { Injectable } from "@nestjs/common";
import type { StayNotice } from "@repo/contracts";

/**
 * What a module that follows the life of a stay may listen for. The booking side calls it
 * and knows nobody on the other end: `payout` registers in its own `onModuleInit`, so the
 * dependency runs from the module that follows to the module that is followed.
 */
export interface StayListener {
  /** A payment turned the hold into a stay. */
  confirmed?(stay: StayNotice): Promise<void>;

  /**
   * A refund has been issued for the stay and the stay records it in its refund total. A
   * cancellation calls it before the cancellation is written and goes ahead if it fails;
   * the refund's webhook calls it again.
   */
  refunded?(bookingId: string): Promise<void>;
}

/**
 * The seam from `BookingService` to whoever follows its stays, in the process and awaited:
 * a listener's failure reaches the caller, which is what turns a settlement the webhook
 * could not finish into a delivery that comes again. It is a registry rather than an
 * event bus on purpose — a bus that does not wait would lose that.
 */
@Injectable()
export class StayLifecycle {
  private readonly listeners: StayListener[] = [];

  register(listener: StayListener): void {
    this.listeners.push(listener);
  }

  async confirmed(stay: StayNotice): Promise<void> {
    for (const listener of this.listeners) {
      await listener.confirmed?.(stay);
    }
  }

  async refunded(bookingId: string): Promise<void> {
    for (const listener of this.listeners) {
      await listener.refunded?.(bookingId);
    }
  }
}
