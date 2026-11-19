import Stripe from "stripe";
import type { PaymentConfig } from "./payment.config";

/** One client for both adapters, provided by `PaymentModule` and exported beside the config. */
export const STRIPE_CLIENT = Symbol("STRIPE_CLIENT");

/**
 * Pinned, so an upgrade of `stripe` cannot change the shape of answers unnoticed. The
 * compiler accepts only the version the SDK is typed against, and the webhook endpoints
 * have to deliver in it too — `readEvent` warns about an event in another.
 */
export const STRIPE_API_VERSION = "2026-10-28.endive";

/**
 * Four seconds a call and no SDK retry: the SDK's 80-second default outlives the
 * frontend's ten, and a request makes up to two calls. Whatever ran the call retries
 * instead, safely, because every write goes under an idempotency key. A call nobody waits
 * on overrides both per request with `BACKGROUND_REQUEST`.
 */
export function createStripeClient(config: PaymentConfig): Stripe {
  return new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    timeout: 4_000,
    maxNetworkRetries: 0,
    ...(config.off ? { httpClient: STRIPE_OFF_CLIENT } : {}),
  });
}

/**
 * What the SDK sends through with Stripe off: nothing. Every call is refused before a socket
 * opens, and the SDK reports it as the connection error an unreachable Stripe gives — so the
 * API takes the path it takes in an outage, and a call nobody expected shows in the log
 * under its own path instead of leaving the machine. Below the adapters rather than in place
 * of them, so a call added to either one later is refused too.
 */
const STRIPE_OFF_CLIENT: NonNullable<Stripe.StripeConfig["httpClient"]> = {
  getClientName: () => "stripe-off",
  makeRequest: (_host, _port, path, method) =>
    Promise.reject(
      new Error(`Stripe is off (STRIPE_OFF): ${method} ${path} was not sent`),
    ),
};

/**
 * Per-request options for the calls a job or a webhook handler makes, where nobody waits on
 * the answer and the 10-second budget of the frontend does not apply: a longer wait and the
 * SDK's own retries (a dropped connection, a `429`, a `5xx`) settle a blip without spending
 * an attempt of the queue. Safe to repeat because every write goes under an idempotency key,
 * and the SDK mints one for a write that has none. A job's lease outlives the worst case —
 * three tries of eight seconds — by the renewal it runs under.
 */
export const BACKGROUND_REQUEST = {
  timeout: 8_000,
  maxNetworkRetries: 2,
} satisfies Stripe.RequestOptions;

/** An expandable field, read as the id whether or not it was expanded. */
export function idOf(field: string | { id: string } | null): string | null {
  return typeof field === "string" ? field : (field?.id ?? null);
}

export function transferGroupOf(bookingId: string): string {
  return `booking-${bookingId}`;
}
