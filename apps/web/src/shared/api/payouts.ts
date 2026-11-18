import {
  accountSessionSchema,
  hostAccountSchema,
  payoutCountriesSchema,
  type AccountSession,
  type HostAccount,
  type OpenPayoutAccountInput,
  type PayoutCountries,
} from "@repo/contracts";
import { apiRequest } from "./http-client";

/**
 * The caller's own payout account — the routes take no id, the session names the account.
 * The answers are personal and never cached, so no method takes `ReadOptions`.
 */
export const payoutsApi = {
  account: (): Promise<HostAccount> =>
    apiRequest({
      method: "GET",
      path: "/payouts/account",
      schema: hostAccountSchema,
      read: { cache: "no-store" },
    }),

  /** Stripe's list for the platform's country; the API keeps it, so the read is cheap. */
  countries: (): Promise<PayoutCountries> =>
    apiRequest({
      method: "GET",
      path: "/payouts/account/countries",
      schema: payoutCountriesSchema,
      read: { cache: "no-store" },
    }),

  /**
   * Opens the account at Stripe in the country the host picked; a second call answers the
   * first. Waits past the usual ten seconds: Stripe takes over four to open an account and
   * the API gives it eight, after up to two reads of four for a country list it has not
   * kept yet.
   */
  open: (input: OpenPayoutAccountInput): Promise<HostAccount> =>
    apiRequest({
      method: "POST",
      path: "/payouts/account",
      schema: hostAccountSchema,
      body: input,
      timeoutMs: 20_000,
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
