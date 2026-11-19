/**
 * The demo accounts the seed writes (`apps/api/prisma/seed.ts`). Shared by every test, so a
 * test only ever signs in to one — never changes it (`docs/e2e-scenarios.md`).
 */
export const DEMO_PASSWORD = "password123";

export const DEMO = {
  guest: {
    name: "Maya Lindqvist",
    email: "guest@example.com",
    // The seed's 2026-01-15T18:00Z, a day later on the reader's clock (Pacific/Auckland,
    // `playwright.config.ts`) than on UTC's.
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
