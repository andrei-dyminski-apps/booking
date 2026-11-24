import { ActorKind } from "./enums.js";

/** Public accounts offered by the demo sign-in links and created by the seed. */
export const DEMO_ACCOUNT_EMAILS = {
  [ActorKind.GUEST]: "guest@example.com",
  [ActorKind.HOST]: "owner@example.com",
  [ActorKind.ADMIN]: "admin@example.com",
} as const;

export type DemoAccountId = keyof typeof DEMO_ACCOUNT_EMAILS;
