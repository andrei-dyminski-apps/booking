/** Injection token, for the reason `AUTH_CONFIG` is one: the config is a plain object. */
export const PAYMENT_CONFIG = Symbol("PAYMENT_CONFIG");

export type PaymentConfig = {
  /** The secret API key; a test-mode `sk_test_…` anywhere but production. */
  secretKey: string;
  /** What signs the payment deliveries (`/payments/webhook`); `stripe listen` prints its own locally. */
  paymentWebhookSecret: string;
  /**
   * What signs the payout deliveries (`/payouts/webhook`, the connected accounts of hosts)
   * — a destination of its own in Stripe, with a secret of its own. `stripe listen` signs
   * both kinds with one secret, so locally this is the payment secret again.
   */
  payoutWebhookSecret: string;
  /**
   * The name of this deployment on the payments it opens. A test account is shared — the
   * deployment and every developer's `stripe listen` hear every event of it — and a payment
   * succeeding for a booking another database holds would otherwise read here as one whose
   * hold is gone, and be refunded.
   */
  site: string;
};

function required(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(`${name} is not set — copy .env.example to .env`);
  }

  return value;
}

/**
 * No fallback, the rule the JWT secrets follow: a missing secret stops the process at boot
 * rather than shipping a webhook that accepts what anybody signs. The payout webhook's
 * secret falls back to the payment one, because `stripe listen` signs both kinds with one.
 * The site falls back to `local` outside production only.
 */
export function loadPaymentConfig(): PaymentConfig {
  const paymentWebhookSecret = required("STRIPE_PAYMENT_WEBHOOK_SECRET");

  return {
    secretKey: required("STRIPE_SECRET_KEY"),
    paymentWebhookSecret,
    payoutWebhookSecret:
      process.env.STRIPE_PAYOUT_WEBHOOK_SECRET || paymentWebhookSecret,
    site:
      process.env.NODE_ENV === "production"
        ? required("STRIPE_SITE")
        : process.env.STRIPE_SITE || "local",
  };
}
