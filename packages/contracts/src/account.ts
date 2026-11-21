import { z } from "zod";
import { rule, type ErrorCode } from "./error-code.js";

/**
 * What an erased account is called wherever its name is still shown — on the other side of
 * a stay, under a review, in a thread. Deleting an account erases the person, not the
 * history: the rows the money and the other party's history rest on stay, and point at an
 * account that answers to this name.
 */
export const DELETED_USER_NAME = "Deleted user";

/**
 * The body of `DELETE /users/me`: the password typed again, so a session alone — a tab left
 * open, a stolen cookie — cannot erase an account. A plain non-empty string, as at login: a
 * password the policy has tightened past since still belongs to its owner.
 */
export const deleteAccountSchema = z.object({
  password: z
    .string()
    .min(1, { error: rule("PASSWORD_REQUIRED", "Password is required") }),
});

/**
 * What can still be open on an account and keeps it from being erased, in the order a
 * refusal names them: a stay first, since the money behind the others usually waits on one.
 * Each is a code of its own (`ERROR_CODES`); a refusal answers with the first one open and
 * lists every one in `params` (`openMattersParamsSchema`), so the page can name them all at
 * once.
 *
 * - `ACCOUNT_HAS_OPEN_STAY` — a hold or a confirmed stay not yet over, as a guest or a host.
 * - `ACCOUNT_HAS_OPEN_DISPUTE` — a payment of a stay of theirs disputed and not yet decided.
 * - `ACCOUNT_AWAITS_REFUND` — a refund owed to the account as a guest, decided and not yet
 *   sent, or one a bank sent back that nobody has settled yet. Only ever the guest's: a
 *   refund owed on a stay the account hosted goes back to its guest without the host.
 * - `ACCOUNT_AWAITS_PAYOUT` — a host's share that no payout can reach once the account is
 *   gone: owed while the host's payouts are not enabled, or set aside after failing — what is
 *   left of it after a refund still owed to the guest included. A share that payouts can
 *   still reach does not count — it is paid to the connected account after the erasure, as
 *   it would have been before.
 * - `ACCOUNT_OWES_HOST_FEE` — a host fee neither withheld in full nor waived.
 */
export const ACCOUNT_OPEN_MATTERS = [
  "ACCOUNT_HAS_OPEN_STAY",
  "ACCOUNT_HAS_OPEN_DISPUTE",
  "ACCOUNT_AWAITS_REFUND",
  "ACCOUNT_AWAITS_PAYOUT",
  "ACCOUNT_OWES_HOST_FEE",
] as const satisfies readonly ErrorCode[];

export const openMatterSchema = z.enum(ACCOUNT_OPEN_MATTERS);

/**
 * What each matter is, in a sentence both sides say: the API as the message of the refusal
 * that names it first, the profile page as one line of the list of what to finish.
 */
export const OPEN_MATTER_MESSAGES: Record<OpenMatter, string> = {
  ACCOUNT_HAS_OPEN_STAY:
    "A stay of yours is still booked or under way — cancel it or wait until it is over",
  ACCOUNT_HAS_OPEN_DISPUTE:
    "A payment for a stay of yours is disputed and not decided yet",
  ACCOUNT_AWAITS_REFUND:
    "A refund for a stay of yours is still on its way to you — if your bank sent it back, we will be in touch to send it another way",
  ACCOUNT_AWAITS_PAYOUT:
    "Your share of a stay has no payout account that can receive it — set up payouts first",
  ACCOUNT_OWES_HOST_FEE: "You still owe a host cancellation fee",
};

/**
 * The `params` of a refusal for something still open: every matter open, in that order, and
 * which of them are open on each side of the account's stays — as their guest (`asGuest`)
 * and as the host of the listing (`asHost`) — so the page can point at the half of the stays
 * that holds each. A refund owed is only ever the guest's, a host's share and a host's fee
 * only ever the host's.
 */
export const openMattersParamsSchema = z.object({
  open: z.array(openMatterSchema).min(1),
  asGuest: z.array(openMatterSchema),
  asHost: z.array(openMatterSchema),
});

export type OpenMatter = z.infer<typeof openMatterSchema>;
export type OpenMattersParams = z.infer<typeof openMattersParamsSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
