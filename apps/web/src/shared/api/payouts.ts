import {
  accountSessionSchema,
  hostAccountSchema,
  type AccountSession,
  type HostAccount,
} from "@repo/contracts";
import { apiRequest } from "./http-client";

/**
 * The caller's own payout account — the routes take no id, the session names the account.
 * Both answers are personal and never cached, so neither method takes `ReadOptions`.
 */
export const payoutsApi = {
  account: (): Promise<HostAccount> =>
    apiRequest({
      method: "GET",
      path: "/payouts/account",
      schema: hostAccountSchema,
      read: { cache: "no-store" },
    }),

  /** Asks Stripe where an unfinished onboarding stands, and writes the answer down. */
  refresh: (): Promise<HostAccount> =>
    apiRequest({
      method: "POST",
      path: "/payouts/account/refresh",
      schema: hostAccountSchema,
    }),

  /**
   * What Stripe's embedded components are initialised with, asked for by the browser
   * whenever the components need one — a session runs out within minutes, so it is never
   * read by a server render and handed down.
   */
  session: (): Promise<AccountSession> =>
    apiRequest({
      method: "POST",
      path: "/payouts/account/session",
      schema: accountSessionSchema,
    }),
};
