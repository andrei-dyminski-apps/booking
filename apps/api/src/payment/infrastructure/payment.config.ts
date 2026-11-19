/** Injection token, for the reason `AUTH_CONFIG` is one: the config is a plain object. */
export const PAYMENT_CONFIG = Symbol("PAYMENT_CONFIG");

export type PaymentConfig = {
  /**
   * `STRIPE_STAND_IN_URL`: the browser suite's stack, where Stripe is played by a stand-in
   * on this machine (`apps/web/e2e/stripe`). The client sends every call there instead of
   * to Stripe (`createStripeClient`), and the stand-in signs its deliveries with the
   * webhook secret below, so the adapters, the inbox and the handlers run as they do
   * against Stripe. `null` everywhere else.
   */
  standIn: URL | null;
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
 * A stand-in changes where the calls go and nothing else: the key and the secrets are
 * required as they are against Stripe, and the stand-in is handed the same ones. A
 * deployment refuses it, since a production API whose payments go nowhere is worse than
 * one that does not start.
 */
export function loadPaymentConfig(): PaymentConfig {
  const production = process.env.NODE_ENV === "production";
  const standIn = standInUrl();

  if (standIn !== null && production) {
    throw new Error(
      "STRIPE_STAND_IN_URL is for the browser suite's stack — a deployment cannot take its payments from a stand-in",
    );
  }

  const paymentWebhookSecret = required("STRIPE_PAYMENT_WEBHOOK_SECRET");

  return {
    standIn,
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

/** The hosts a stand-in may listen on: the key goes with every call, so never off this machine. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Unset or empty is Stripe itself; anything else has to be an origin on this machine. Only
 * an origin: the SDK takes a host and a port, so a path or credentials would be dropped
 * without a word.
 */
function standInUrl(): URL | null {
  const value = process.env.STRIPE_STAND_IN_URL;

  if (value === undefined || value === "") return null;

  const url = URL.parse(value);

  if (
    url === null ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      `STRIPE_STAND_IN_URL must be an http(s) origin on this machine, not "${value}"`,
    );
  }

  return url;
}
