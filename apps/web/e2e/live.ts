import type { Account } from "./support/demo";

/**
 * The live deployment the `live` target runs against (`target.ts`): the frontend on
 * Vercel, the API with its Postgres and Redis on Railway behind it. The suite talks to the
 * frontend alone, as a visitor does — the API is reached through its BFF.
 */
export const LIVE_ORIGIN = "https://booking-beige-five.vercel.app";

/** The suite uses its dedicated accounts unless replacement inboxes are configured. */
export const LIVE_ACCOUNTS = {
  guest: { name: "Ines Calder", email: "browser-suite-guest@e2e.example" },
  host: { name: "Oskar Lund", email: "browser-suite-host@e2e.example" },
} as const;

/** The secret both accounts sign in with; a run without it stops before any scenario. */
export function livePassword(): string {
  const password = process.env.E2E_LIVE_PASSWORD ?? "";

  if (password === "") {
    throw new Error(
      "The live target signs in to the suite's own accounts: set E2E_LIVE_PASSWORD (the root .env locally, a repository secret in CI)",
    );
  }

  return password;
}

/**
 * One of the suite's live accounts, with its password read when it is used rather than
 * now: the spec files are loaded to collect their tests before the global setup runs, and a
 * run that finds the demo stopped skips every scenario without needing the secret.
 */
export function liveAccount(role: keyof typeof LIVE_ACCOUNTS): Account {
  return {
    ...LIVE_ACCOUNTS[role],
    email:
      (role === "guest"
        ? process.env.E2E_LIVE_GUEST_EMAIL
        : process.env.E2E_LIVE_HOST_EMAIL
      )?.trim() || LIVE_ACCOUNTS[role].email,
    get password() {
      return livePassword();
    },
  };
}

/**
 * Set by the global setup when the demo is stopped (`live-setup.ts`), for the workers it
 * starts afterwards: every scenario is then skipped with this notice.
 */
export const LIVE_STOPPED_ENV = "E2E_LIVE_STOPPED";

export const LIVE_STOPPED_NOTICE =
  "The live demo is stopped (Railway answers that no deployment is running): its scenarios are skipped";

/**
 * The day the suite's guest was registered, as the profile writes it on the reader's
 * clock — read by the global setup off the account, since it is the day of the first run
 * rather than a constant.
 */
export const LIVE_GUEST_JOINED_ENV = "E2E_LIVE_GUEST_JOINED";

export function liveStopped(): boolean {
  return process.env[LIVE_STOPPED_ENV] === "1";
}

/**
 * Set by the global setup once it has gone through (`live-setup.ts`), for the teardown:
 * Playwright runs the teardown after a setup that threw too, and a teardown that signed in
 * again would spend sign-ins and bury the setup's error under one of its own.
 */
export const LIVE_READY_ENV = "E2E_LIVE_READY";

export function liveReady(): boolean {
  return process.env[LIVE_READY_ENV] === "1";
}
