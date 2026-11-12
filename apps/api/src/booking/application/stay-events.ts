import { Injectable } from "@nestjs/common";
import type { CheckIn } from "@repo/contracts";

/** A stay a payment confirmed, and when it begins — what its payout falls due by. */
export type ConfirmedStayEvent = { bookingId: string; checkIn: CheckIn };

/** `payout` registers in its own `onModuleInit`, so `booking` knows nobody on the other end. */
export interface StayEventsListener {
  confirmed?(stay: ConfirmedStayEvent): Promise<void>;

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
export class StayEvents {
  private readonly listeners: StayEventsListener[] = [];

  register(listener: StayEventsListener): void {
    this.listeners.push(listener);
  }

  async confirmed(stay: ConfirmedStayEvent): Promise<void> {
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
