import { defineConfig, devices } from "@playwright/test";
import {
  API_COMMAND,
  API_ENV,
  API_HEALTH_URL,
  STRIPE_STAND_IN_COMMAND,
  STRIPE_STAND_IN_ENV,
  STRIPE_STAND_IN_HEALTH_URL,
  WEB_COMMAND,
  WEB_ENV,
  WEB_ORIGIN,
} from "./e2e/stack";

const CI = process.env.CI !== undefined && process.env.CI !== "";

/**
 * The browser suite: the scenarios of `docs/e2e-scenarios.md`, run against the hermetic
 * stack of `e2e/stack.ts`, which the servers below start — the stand-in for Stripe, the API
 * after its database and Redis are recreated and seeded, then the frontend. Nothing already
 * listening is reused: a server the suite did not start is one whose database it does not
 * own.
 */
export default defineConfig({
  testDir: "./e2e",
  // The Stripe stand-in's last word: what the API did after the last test (`e2e/stripe`).
  globalTeardown: "./e2e/global-teardown.ts",
  // The tests share the demo accounts, so they run one at a time, here and in CI.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  // One retry in CI, and a test that needed it is reported as flaky. Locally a failure is
  // what it is.
  retries: CI ? 1 : 0,
  // In CI the run stops itself well inside the job's ten-minute budget, the stack's start-up
  // included: a hang then ends as a failed run with its report written, rather than as a job
  // GitHub cancels with nothing kept.
  globalTimeout: CI ? 6 * 60_000 : 0,
  reporter: CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: WEB_ORIGIN,
    // The reader's clock, the same on every machine: a zone far from UTC, so a moment drawn
    // on the server's clock instead of the reader's shows as another day for most of it.
    locale: "en-GB",
    timezoneId: "Pacific/Auckland",
    // What a failure leaves behind, so it is read rather than rerun.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // What a narrow screen changes, walked once more: how a visitor gets around (the sheet
    // behind the menu button in place of the sidebar) and the catalogue up to a listing's
    // page. The rest runs the same code on both, so it is not repeated here.
    {
      name: "phone",
      use: { ...devices["Pixel 7"] },
      testMatch: ["**/navigation.spec.ts", "**/catalogue.spec.ts"],
    },
  ],
  webServer: [
    {
      name: "stripe",
      command: STRIPE_STAND_IN_COMMAND,
      url: STRIPE_STAND_IN_HEALTH_URL,
      env: STRIPE_STAND_IN_ENV,
      reuseExistingServer: false,
    },
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
      url: WEB_ORIGIN,
      env: WEB_ENV,
      reuseExistingServer: false,
    },
  ],
});
