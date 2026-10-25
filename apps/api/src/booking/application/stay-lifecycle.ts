import { Injectable } from "@nestjs/common";
import type { StayNotice } from "@repo/contracts";

/** `payout` registers in its own `onModuleInit`, so `booking` knows nobody on the other end. */
export interface StayListener {
  confirmed?(stay: StayNotice): Promise<void>;

  /**
   * The refund job only logs a failure here; the refund's webhook calls it again, and
   * there a failure is retried.
   */
  refunded?(bookingId: string): Promise<void>;
}

/**
 * Awaited rather than an event bus: a listener's failure reaches the caller, which turns a
 * settlement the webhook could not finish into a delivery that comes again.
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
