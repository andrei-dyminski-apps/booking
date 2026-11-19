import { randomBytes } from "node:crypto";

/** Injection token, for the reason `AUTH_CONFIG` is one: the config is a plain object. */
export const PAYMENT_CONFIG = Symbol("PAYMENT_CONFIG");

export type PaymentConfig = {
  /**
   * `STRIPE_OFF`: the browser suite's stack, where nothing may reach Stripe. The client then
   * refuses every call inside the process (`createStripeClient`), so the API meets an
   * unreachable provider, and no webhook can be signed.
   */
  off: boolean;
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
 * than shipping a webhook that accepts what anybody signs. The payout secret falls back to
 * the payment one only outside production, where `stripe listen` signs both kinds with one;
 * a deployment has two destinations with two secrets, and a forgotten one would otherwise
 * answer every account event `400` with nothing saying why.
 *
 * With Stripe off nothing is required and nothing is accepted: the key is never sent, and
 * the webhook secrets are drawn afresh at every boot and told to nobody. A deployment
 * refuses the mode, since a production API that quietly takes no payments is worse than
 * one that does not start.
 */
export function loadPaymentConfig(): PaymentConfig {
  const production = process.env.NODE_ENV === "production";

  if (stripeOff()) {
    if (production) {
      throw new Error(
        "STRIPE_OFF is for the browser suite's stack — a deployment cannot run with Stripe off",
      );
    }

    const unknowable = `whsec_off_${randomBytes(24).toString("hex")}`;

    return {
      off: true,
      secretKey: "sk_test_off",
      paymentWebhookSecret: unknowable,
      payoutWebhookSecret: unknowable,
      site: process.env.STRIPE_SITE || "off",
    };
  }

  const paymentWebhookSecret = required("STRIPE_PAYMENT_WEBHOOK_SECRET");

  return {
    off: false,
    secretKey: required("STRIPE_SECRET_KEY"),
    paymentWebhookSecret,
    payoutWebhookSecret: production
      ? required("STRIPE_PAYOUT_WEBHOOK_SECRET")
      : process.env.STRIPE_PAYOUT_WEBHOOK_SECRET || paymentWebhookSecret,
    site: production
      ? required("STRIPE_SITE")
      : process.env.STRIPE_SITE || "local",
  };
}

/** `true` turns Stripe off; unset, empty or `false` leaves it on; anything else is a typo. */
function stripeOff(): boolean {
  const value = process.env.STRIPE_OFF;

  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;

  throw new Error(`STRIPE_OFF must be "true" or "false", not "${value}"`);
}
