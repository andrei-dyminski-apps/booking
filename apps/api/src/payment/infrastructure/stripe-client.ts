import Stripe from "stripe";

/**
 * Pinned, so an upgrade of `stripe` cannot change the shape of answers unnoticed. The
 * compiler accepts only the version the SDK is typed against, and the webhook endpoints
 * have to deliver in it too — `readEvent` warns about an event in another.
 */
export const STRIPE_API_VERSION = "2026-09-30.endive";

/**
 * Four seconds a call and no SDK retry: the SDK's 80-second default outlives the
 * frontend's ten, and a request makes up to two calls. Whatever ran the call retries
 * instead, safely, because every write goes under an idempotency key.
 */
export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    timeout: 4_000,
    maxNetworkRetries: 0,
  });
}

export function fromMinorUnits(minor: number): number {
  return minor / 100;
}

/** An expandable field, read as the id whether or not it was expanded. */
export function idOf(field: string | { id: string } | null): string | null {
  return typeof field === "string" ? field : (field?.id ?? null);
}

export function transferGroupOf(bookingId: string): string {
  return `booking-${bookingId}`;
}
