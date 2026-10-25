/** Injection token, for the reason `AUTH_CONFIG` is one: the config is a plain object. */
export const PAYMENT_CONFIG = Symbol("PAYMENT_CONFIG");

export type PaymentConfig = {
  secretKey: string;
  paymentWebhookSecret: string;
  /** A destination of its own in Stripe; locally `stripe listen` signs both with one secret. */
  payoutWebhookSecret: string;
  /**
   * This deployment's name on its payments. A test account is shared, and another
   * database's payment would otherwise read here as a lapsed hold's and be refunded.
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
 * No fallback for the secrets, like the JWT ones: a missing secret stops the boot rather
 * than shipping a webhook that accepts what anybody signs.
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
