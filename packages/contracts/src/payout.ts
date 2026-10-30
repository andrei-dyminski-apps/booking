import { tz } from "@date-fns/tz";
import { addHours, parseISO } from "date-fns";
import { z } from "zod";
import { DisputeStatus, type Booking } from "./booking.js";
import {
  addCents,
  BASIS_POINTS,
  NO_CENTS,
  shareOf,
  type Cents,
} from "./money.js";
import { notRefunded } from "./refund.js";

/**
 * Here for the reason `refundOnCancel` is: the API transfers by it and the host's screens
 * state it. The host is paid once the stay has begun, so until then a cancellation takes
 * nothing back from anybody.
 */

/**
 * What the platform keeps of a stay, in basis points — 1500 is 15% — so the rate is an
 * integer like the amounts it is applied to. Stripe's fees come out of it.
 */
export const PLATFORM_FEE_BPS = 1_500;

/** A guest who arrives to a place not as described has that day to say so. */
export const PAYOUT_DELAY_HOURS = 24;

const IN_UTC = { in: tz("UTC") };

/**
 * What the host is paid of what the guest kept paying: 85% of 36105 cents is 30689, rounded
 * half up, in the host's favour. The rounding happens once, here, and the platform keeps
 * whatever is left of the money, so no cent is lost or invented between the two.
 */
export function hostShare(amount: Cents, refunded: Cents): Cents {
  return shareOf(
    notRefunded(amount, refunded),
    BASIS_POINTS - PLATFORM_FEE_BPS,
  );
}

/**
 * What the host should end up holding of a stay: nothing for one never paid or whose
 * dispute was lost — the bank took the money back from the platform, and the host's share
 * with it — and otherwise `hostShare` of what the guest kept paying, a refund still owed
 * counted as gone already, since paying it out would only be taken back. The API transfers
 * and reverses by it, and the admin's screen of stuck payouts states it.
 */
export function owedToHost(
  stay: Pick<
    Booking,
    | "amountCents"
    | "refundedAmountCents"
    | "refundOwedCents"
    | "paid"
    | "dispute"
  >,
): Cents {
  if (!stay.paid || stay.dispute === DisputeStatus.LOST) return NO_CENTS;

  return hostShare(
    stay.amountCents,
    addCents(
      stay.refundedAmountCents ?? NO_CENTS,
      stay.refundOwedCents ?? NO_CENTS,
    ),
  );
}

/** Midnight UTC of the check-in day, the clock every rule about a calendar day reads. */
export function payoutDueAt(from: string): Date {
  return new Date(
    addHours(parseISO(from, IN_UTC), PAYOUT_DELAY_HOURS, IN_UTC).getTime(),
  );
}

/**
 * Where a host stands with payouts. `NOT_STARTED` has no Stripe account yet, `ONBOARDING`
 * has one that cannot receive transfers yet — details still owed, or under review — and
 * `ENABLED` is paid as its stays fall due.
 */
export const hostAccountStatusSchema = z.enum([
  "NOT_STARTED",
  "ONBOARDING",
  "ENABLED",
]);

export const HostAccountStatus = hostAccountStatusSchema.enum;

/** `GET /payouts/account` — the caller's own payout account. */
export const hostAccountSchema = z.object({
  status: hostAccountStatusSchema,
});

/** Short-lived, so asked for whenever the components need one rather than stored. */
export const accountSessionSchema = z.object({
  clientSecret: z.string().min(1),
});

export type HostAccountStatus = z.infer<typeof hostAccountStatusSchema>;
export type HostAccount = z.infer<typeof hostAccountSchema>;
export type AccountSession = z.infer<typeof accountSessionSchema>;
