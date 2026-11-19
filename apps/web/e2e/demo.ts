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
} as const;

export type DemoAccount = (typeof DEMO)[keyof typeof DEMO];
