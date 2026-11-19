/**
 * The hermetic stack the browser suite runs against: the production builds of both
 * applications, on a database and a Redis of their own (`compose.yml`), on ports apart from
 * the development stack's so the two run side by side.
 *
 * Its whole environment is stated here rather than read from the root `.env`. Playwright
 * hands a server the runner's environment with these values on top, and the runner is
 * started by turbo with `.env` loaded — so every variable either application reads is set
 * here, the empty ones included, and none falls through to `.env`. That is what keeps the
 * reset on its own
 * database: the seed wipes whatever `DATABASE_URL` names, and the only one it is ever
 * given is the one below.
 */

const WEB_PORT = 3200;
const API_PORT = 3201;

/** The ports `compose.yml` publishes. */
const POSTGRES_PORT = 5433;
const REDIS_PORT = 6380;

export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;

const POSTGRES = { user: "booking", password: "booking", db: "booking_e2e" };

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

  STRIPE_OFF: "true",
  STRIPE_SECRET_KEY: "",
  STRIPE_PAYMENT_WEBHOOK_SECRET: "",
  STRIPE_PAYOUT_WEBHOOK_SECRET: "",
  STRIPE_SITE: "e2e",
  STRIPE_PUBLISHABLE_KEY: "",

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
  `pnpm --filter @repo/api start:prod > ${SERVER_LOGS}/api.log`,
].join(" && ");

export const API_HEALTH_URL = `${API_ORIGIN}/health`;

/**
 * The API runs its production build outside production mode, which is what lets it boot
 * with Stripe off; the frontend is in production mode as `next start` is anywhere.
 */
export const API_ENV = { ...STACK_ENV, NODE_ENV: "development" };

export const WEB_COMMAND = `mkdir -p ${SERVER_LOGS} && pnpm start > ${SERVER_LOGS}/web.log`;

export const WEB_ENV = { ...STACK_ENV, NODE_ENV: "production" };
