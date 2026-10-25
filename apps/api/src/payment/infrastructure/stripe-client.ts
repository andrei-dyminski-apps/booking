import Stripe from "stripe";

/**
 * What the two Stripe adapters share: how a client is built, and how money crosses into the
 * provider's minor units and back. The contract speaks euros to the cent, Stripe speaks
 * cents, and the adapters multiply with `toCents` from `domain/money.ts` — the one the
 * idempotency keys are named by.
 */

/**
 * The SDK's own default is 80 seconds, which would hold a request open long after the
 * frontend's transport gave up on it at ten. Four seconds a call, and no retry of the
 * SDK's own: a request a person waits on makes up to two calls, and a retry inside each
 * would push it past those ten. What retries instead is whatever ran the call — the person
 * pressing the button again, a BullMQ job's next attempt, Stripe delivering a webhook
 * again — and that is safe because every write goes under an idempotency key.
 */
export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { timeout: 4_000, maxNetworkRetries: 0 });
}

export function fromMinorUnits(minor: number): number {
  return minor / 100;
}

/** An expandable field of a Stripe object, read as the id whether or not it was expanded. */
export function idOf(field: string | { id: string } | null): string | null {
  return typeof field === "string" ? field : (field?.id ?? null);
}

/** The name a stay's charge and its payout share in the dashboard. */
export function transferGroupOf(bookingId: string): string {
  return `booking-${bookingId}`;
}
