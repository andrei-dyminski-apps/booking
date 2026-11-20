import { TARGET } from "./target";

/**
 * The hermetic stack the browser suite runs against: the production builds of both
 * applications, on a database and a Redis of their own (`compose.yml`), with Stripe played
 * by the suite's stand-in (`stripe/server.ts`), on ports apart from the development stack's
 * so the two run side by side.
 *
 * Its whole environment is stated here rather than read from the root `.env`. Playwright
 * hands a server the runner's environment with these values on top, and the runner is
 * started by turbo with `.env` loaded — so every variable either application reads is set
 * here, the empty ones included, and none falls through to `.env`. That is what keeps the
 * reset on its own
 * database: the seed wipes whatever `DATABASE_URL` names, and the only one it is ever
 * given is the one below.
 *
 * The real-Stripe target (`target.ts`) is the same stack with Stripe's side real, and the
 * Stripe keys are the one thing it takes from `.env`: they name the developer's sandbox, and
 * only a test key is accepted.
 */

const WEB_PORT = 3200;
const API_PORT = 3201;
const STRIPE_STAND_IN_PORT = 3202;

/** The ports `compose.yml` publishes. */
const POSTGRES_PORT = 5433;
const REDIS_PORT = 6380;

export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
export const STRIPE_STAND_IN_ORIGIN = `http://127.0.0.1:${STRIPE_STAND_IN_PORT}`;

const POSTGRES = { user: "booking", password: "booking", db: "booking_e2e" };

/**
 * Stripe played by the stand-in (`stripe/server.ts`): the API's client calls it, and it is
 * handed the same keys and signs its deliveries with the same secret. None of them is a key
 * of Stripe's.
 */
const STAND_IN_STRIPE_ENV: Record<string, string> = {
  STRIPE_STAND_IN_URL: STRIPE_STAND_IN_ORIGIN,
  STRIPE_SECRET_KEY: "sk_test_stand_in",
  STRIPE_PAYMENT_WEBHOOK_SECRET: "whsec_stand_in",
  STRIPE_PAYOUT_WEBHOOK_SECRET: "",
  STRIPE_SITE: "e2e",
  STRIPE_PUBLISHABLE_KEY: "pk_test_stand_in",
};

/**
 * Stripe itself: the sandbox of the root `.env`, refused unless both keys are test keys —
 * a run opens payments, refunds and payout accounts there. The webhook secrets are the
 * listener's, read by `API_COMMAND` when the API starts.
 *
 * The site is new on every run. The sandbox is shared with the developer's own stack and
 * its `stripe listen`, and the two hear each other's events; each API leaves a payment of
 * another site alone, and a run's database starts empty, so a payment an earlier run left
 * — a hold it never paid, a webhook still on its way — must not read as one of this run's.
 */
function realStripeEnv(): Record<string, string> {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY ?? "";

  if (!/^[sr]k_test_/.test(secretKey)) {
    throw new Error(
      "The real-Stripe target runs against a sandbox: STRIPE_SECRET_KEY in the root .env has to be a test key (sk_test_…)",
    );
  }

  if (!publishableKey.startsWith("pk_test_")) {
    throw new Error(
      "The real-Stripe target runs against a sandbox: STRIPE_PUBLISHABLE_KEY in the root .env has to be a test key (pk_test_…)",
    );
  }

  return {
    STRIPE_STAND_IN_URL: "",
    STRIPE_SECRET_KEY: secretKey,
    STRIPE_PAYMENT_WEBHOOK_SECRET: "",
    STRIPE_PAYOUT_WEBHOOK_SECRET: "",
    STRIPE_SITE: `e2e-${Date.now().toString(36)}`,
    STRIPE_PUBLISHABLE_KEY: publishableKey,
    // What the Stripe CLI reads its key from — never its command line, where `ps` shows it.
    STRIPE_API_KEY: secretKey,
    STRIPE_CLI_TELEMETRY_OPTOUT: "1",
  };
}

const STACK_ENV: Record<string, string> = {
  WEB_PORT: String(WEB_PORT),
  API_PORT: String(API_PORT),
  API_HOST: "127.0.0.1",
  PORT: "",
  WEB_ORIGIN,
  API_ORIGIN,
  SITE_ORIGIN: WEB_ORIGIN,

  POSTGRES_USER: POSTGRES.user,
  POSTGRES_PASSWORD: POSTGRES.password,
  POSTGRES_DB: POSTGRES.db,
  POSTGRES_PORT: String(POSTGRES_PORT),
  DATABASE_URL: `postgresql://${POSTGRES.user}:${POSTGRES.password}@localhost:${POSTGRES_PORT}/${POSTGRES.db}`,
  REDIS_PORT: String(REDIS_PORT),
  REDIS_URL: `redis://localhost:${REDIS_PORT}`,

  JWT_ACCESS_SECRET: "browser-suite-access-secret",
  JWT_REFRESH_SECRET: "browser-suite-refresh-secret",
  JWT_ACCESS_TTL: "900",
  JWT_REFRESH_TTL: "604800",
  AUTH_COOKIE_DOMAIN: "",

  // Every test sends an address of its own in `x-forwarded-for` (`fixtures.ts`), which the
  // frontend passes on untouched, and the API believes that one entry: each test gets a
  // bucket of its own in the rate limiter, so one test's sign-ins never get another's
  // refused. A value nobody should copy — anywhere else it lets a client pick its own bucket.
  TRUST_PROXY: "1",

  ...(TARGET === "stripe" ? realStripeEnv() : STAND_IN_STRIPE_ENV),

  // The reads a run caches go with its server, never into the next run.
  DATA_CACHE_IN_MEMORY: "true",

  VERCEL_ENV: "",
  VERCEL_PROJECT_PRODUCTION_URL: "",
};

/**
 * Where each server's output goes instead of the reporter's, which a request log would
 * bury. Inside Playwright's output directory, which it empties before it starts the
 * servers, so a file holds one run; CI keeps the directory when a run fails. What fails
 * before a server starts — Docker, a migration — goes to stderr, which the reporter shows.
 */
const SERVER_LOGS = "test-results/servers";

/**
 * The database and Redis are recreated, so they start empty; the committed migrations go
 * in as a deployment applies them, then the demo data. Only then the API, built already by
 * the turbo task this runs under.
 */
export const API_COMMAND = [
  `mkdir -p ${SERVER_LOGS}`,
  "docker compose -f e2e/compose.yml up --detach --force-recreate --wait",
  "pnpm --filter @repo/api db:deploy",
  "pnpm --filter @repo/api db:seed",
  // Against Stripe the deliveries are signed by `stripe listen`, with the secret it keeps
  // for the key — the same for both kinds, as on a developer's machine. An empty or failed
  // answer stops the start rather than booting an API that refuses every event.
  ...(TARGET === "stripe"
    ? [
        'secret="$(stripe listen --print-secret --skip-update)"',
        'test -n "$secret"',
        'export STRIPE_PAYMENT_WEBHOOK_SECRET="$secret" STRIPE_PAYOUT_WEBHOOK_SECRET="$secret"',
      ]
    : []),
  `pnpm --filter @repo/api start:prod > ${SERVER_LOGS}/api.log`,
].join(" && ");

export const API_HEALTH_URL = `${API_ORIGIN}/health`;

/**
 * On the hermetic stack the API runs its production build outside production mode, which
 * is what lets it boot with a stand-in for Stripe. Against Stripe it runs as it does in
 * deployment. The frontend is in production mode as `next start` is anywhere.
 */
export const API_ENV = {
  ...STACK_ENV,
  NODE_ENV: TARGET === "stripe" ? "production" : "development",
};

export const WEB_COMMAND = `mkdir -p ${SERVER_LOGS} && pnpm start > ${SERVER_LOGS}/web.log`;

export const WEB_ENV = { ...STACK_ENV, NODE_ENV: "production" };

/** Node strips the stand-in's types itself; it needs nothing built. */
export const STRIPE_STAND_IN_COMMAND = `mkdir -p ${SERVER_LOGS} && node e2e/stripe/server.ts > ${SERVER_LOGS}/stripe.log`;

export const STRIPE_STAND_IN_HEALTH_URL = `${STRIPE_STAND_IN_ORIGIN}/health`;

export const STRIPE_STAND_IN_ENV = {
  ...STACK_ENV,
  STRIPE_STAND_IN_PORT: String(STRIPE_STAND_IN_PORT),
};

/**
 * Stripe's events, brought from the sandbox to this run's API by `stripe listen` on the
 * real-Stripe target — the same two listeners as the `stripe` profile of the root
 * `docker-compose.yml`, with the same events, but run here on the host: the API listens on
 * 127.0.0.1, where a container cannot reach it. One process per route, since a listener
 * forwards to one; both sign with the secret `API_COMMAND` hands the API. Each is ready once
 * it says so, and its output goes to a log beside the servers' — `tee`, so the line it is
 * waited for still reaches Playwright.
 */
export const STRIPE_LISTENERS = [
  {
    name: "stripe-payments",
    route: "/payments/webhook",
    // Events in the version the API pins, as the root compose file explains.
    flags: "--latest",
    events: [
      "payment_intent.amount_capturable_updated",
      "payment_intent.succeeded",
      "charge.refunded",
      "refund.failed",
      "charge.dispute.created",
      "charge.dispute.closed",
    ],
  },
  {
    name: "stripe-payouts",
    route: "/payouts/webhook",
    flags: "",
    events: [
      "v2.core.account[configuration.recipient].capability_status_updated",
      "v2.core.account[requirements].updated",
    ],
  },
].map(({ name, route, flags, events }) => ({
  name,
  command: [
    `mkdir -p ${SERVER_LOGS}`,
    `stripe listen --skip-update ${flags} --events '${events.join(",")}' --forward-to ${API_ORIGIN}${route} 2>&1 | tee ${SERVER_LOGS}/${name}.log`,
  ].join(" && "),
  env: STACK_ENV,
  wait: { stdout: /Ready!/ },
}));
