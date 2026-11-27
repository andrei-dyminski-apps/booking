import { defineConfig, devices } from "@playwright/test";
import {
  API_COMMAND,
  API_ENV,
  API_HEALTH_URL,
  STRIPE_LISTENERS,
  STRIPE_STAND_IN_COMMAND,
  STRIPE_STAND_IN_ENV,
  STRIPE_STAND_IN_HEALTH_URL,
  LOCAL_WEB_ORIGIN,
  WEB_COMMAND,
  WEB_ENV,
  WEB_ORIGIN,
} from "./e2e/stack";
import { READER_TIME_ZONE } from "./e2e/support/demo";
import { EVERY_TARGET, REAL_STRIPE_ONLY, TARGET } from "./e2e/target";

const CI = process.env.CI !== undefined && process.env.CI !== "";

const REAL_STRIPE = TARGET === "stripe";

const LIVE = TARGET === "live";

/** What the hermetic stack's projects run, and against Stripe and the deployment the desktop. */
const DESKTOP = { name: "desktop", use: { ...devices["Desktop Chrome"] } };

/**
 * The browser suite: the scenarios of `docs/e2e-scenarios.md`, run against the hermetic
 * stack of `e2e/stack.ts`, which the servers below start — the stand-in for Stripe, the API
 * after its database and Redis are recreated and seeded, then the frontend. Nothing already
 * listening is reused: a server the suite did not start is one whose database it does not
 * own.
 *
 * On the real-Stripe target (`e2e/target.ts`) the listeners that bring Stripe's events back
 * take the stand-in's place, and only the scenarios marked for it run. On the live target
 * nothing is started: the scenarios marked for every target run against the deployment,
 * between a global setup and teardown that check the demo and clean up after the run
 * (`e2e/live-setup.ts`, `e2e/live-teardown.ts`).
 */
export default defineConfig({
  testDir: "./e2e/specs",
  globalSetup: LIVE ? "./e2e/live-setup.ts" : undefined,
  // The Stripe stand-in's last word: what the API did after the last test (`e2e/stripe`);
  // on the deployment, the clean-up after the run.
  globalTeardown:
    TARGET === "hermetic"
      ? "./e2e/global-teardown.ts"
      : LIVE
        ? "./e2e/live-teardown.ts"
        : undefined,
  // The tests share the demo accounts, so they run one at a time, here and in CI.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  // One retry in CI, and a test that needed it is reported as flaky. Locally a failure is
  // what it is — and against Stripe always: a failure on Stripe's side is what that target
  // exists to show, and a retry would hide it. Nor on the deployment, where a retry looks
  // like a new visitor while the rate limiter still remembers the first attempt.
  retries: CI && TARGET === "hermetic" ? 1 : 0,
  // Playwright's own thirty seconds a test on the hermetic stack. Against Stripe a scenario
  // types a card into Stripe's form and waits for its webhooks (`providerWait`), up to
  // three-quarters of a minute for a payment and again for a refund, and the payouts
  // scenario waits on an account Stripe opens: under the default the test would be cut off
  // before its own waits ran out. On the deployment the same, and a sign-in may also wait up
  // to a minute for its slot (`e2e/pace.ts`).
  timeout: REAL_STRIPE ? 120_000 : LIVE ? 180_000 : 30_000,
  // In CI the run stops itself well inside the job's budget, the stack's start-up included:
  // a hang then ends as a failed run with its report written, rather than as a job GitHub
  // cancels with nothing kept. The live run is paced, so its budget is its own
  // (`.github/workflows/live.yml`).
  globalTimeout: CI ? (LIVE ? 40 * 60_000 : 8 * 60_000) : 0,
  // On the deployment no HTML report either: it names every step with its arguments, the
  // password typed into the sign-in form among them (`Fill "…"`), and the live workflow
  // keeps its artifacts where anyone may read them. A failure there is read from the log,
  // its screenshot and its video.
  reporter: [
    ...(CI ? [["github"] as const] : []),
    ["list"],
    ...(LIVE ? [] : [["html", { open: "never" }] as const]),
  ],
  use: {
    baseURL: WEB_ORIGIN,
    // A notification can fade in and finish while axe is scanning its action button.
    reducedMotion: "reduce",
    // The site's service worker answers page loads itself, and what a worker fetches
    // passes no route of the context — not the address of each test, not the Stripe
    // stand-in. Off everywhere but the scenario that proves the worker (`offline.spec.ts`).
    serviceWorkers: "block",
    // The reader's clock, the same on every machine (`e2e/support/demo.ts`).
    locale: "en-GB",
    timezoneId: READER_TIME_ZONE,
    // What a failure leaves behind, so it is read rather than rerun. On the deployment no
    // trace: it holds the bodies of the sign-in requests, and the password is a secret
    // there (`e2e/live.ts`) — see `reporter` above for the rest of what is kept.
    trace: LIVE ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: REAL_STRIPE
    ? [
        {
          ...DESKTOP,
          grep: new RegExp(`${EVERY_TARGET}|${REAL_STRIPE_ONLY}`),
        },
      ]
    : LIVE
      ? [{ ...DESKTOP, grep: new RegExp(EVERY_TARGET) }]
      : [
          {
            ...DESKTOP,
            grepInvert: new RegExp(REAL_STRIPE_ONLY),
          },
          // What a narrow screen changes, walked once more: how a visitor gets around (the
          // sheet behind the menu button in place of the sidebar) and the catalogue up to a
          // listing's page. The rest runs the same code on both, so it is not repeated here,
          // and neither is it on another target, which serves the same code.
          {
            name: "phone",
            use: { ...devices["Pixel 7"] },
            testMatch: ["**/navigation.spec.ts", "**/catalogue.spec.ts"],
          },
        ],
  webServer: LIVE
    ? []
    : [
        ...(REAL_STRIPE
          ? STRIPE_LISTENERS
          : [
              {
                name: "stripe",
                command: STRIPE_STAND_IN_COMMAND,
                url: STRIPE_STAND_IN_HEALTH_URL,
                env: STRIPE_STAND_IN_ENV,
                reuseExistingServer: false,
              },
            ]),
        {
          name: "api",
          command: API_COMMAND,
          url: API_HEALTH_URL,
          env: API_ENV,
          reuseExistingServer: false,
          // Recreating the containers, pulling their images on a fresh machine, and the seed.
          timeout: 180_000,
        },
        {
          name: "web",
          command: WEB_COMMAND,
          url: LOCAL_WEB_ORIGIN,
          env: WEB_ENV,
          reuseExistingServer: false,
        },
      ],
});
