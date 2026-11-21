import { LIVE_GUEST_JOINED_ENV, liveAccount } from "./live";
import { TARGET } from "./target";

/**
 * The demo accounts the seed writes (`apps/api/prisma/seed.ts`). Shared by every test, so a
 * test only ever signs in to one — never changes it (`docs/e2e-scenarios.md`).
 */
export const DEMO_PASSWORD = "password123";

/**
 * The reader's clock, the same on every machine (`timezoneId` in `playwright.config.ts`):
 * a zone far from UTC, so a moment drawn on the server's clock instead of the reader's
 * shows as another day for most of it.
 */
export const READER_TIME_ZONE = "Pacific/Auckland";

export const DEMO = {
  guest: {
    name: "Maya Lindqvist",
    email: "guest@example.com",
    // The seed's 2026-01-15T18:00Z, a day later on the reader's clock (`READER_TIME_ZONE`)
    // than on UTC's.
    joined: "16 Jan 2026",
  },
  /** The host of six of the seed's listings, which their dashboard lists. */
  host: {
    name: "Tomas Berg",
    email: "owner@example.com",
  },
  admin: {
    name: "Nora Hale",
    email: "admin@example.com",
  },
} as const;

/** An account to sign in as: a demo one, whose password is `DEMO_PASSWORD`, or a test's own. */
export type Account = { name: string; email: string; password?: string };

/**
 * The guest a scenario signs in as: the demo guest on the local stacks, and on the
 * deployment the suite's own (`live.ts`) — the demo accounts there belong to its visitors,
 * whose list of stays a run must not fill. `joined` is the day the account was opened on
 * the reader's clock; the suite's guest was opened by its first run, so the global setup
 * reads it off the account (`live-setup.ts`).
 */
export const GUEST: Account & { joined: string } =
  TARGET === "live"
    ? // Assigned onto rather than spread, which would read the password's getter now.
      Object.assign(liveAccount("guest"), {
        joined: process.env[LIVE_GUEST_JOINED_ENV] ?? "",
      })
    : DEMO.guest;
