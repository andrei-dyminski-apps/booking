import { tz } from "@date-fns/tz";
import { addHours, parseISO } from "date-fns";
import { z } from "zod";

/**
 * What a host is paid for a stay and when. A rule rather than a schema, and it lives here
 * for the reason `refundOnCancel` does: the API transfers by it and the host's screens
 * state it, so a copy on each side of the wire would be a host promised one sum and paid
 * another the day the two drift.
 *
 * The guest pays the platform; the host is paid by a separate transfer once the stay has
 * begun. Until then a cancellation is refunded out of the platform's own balance and
 * nothing has to be taken back from anybody.
 */

/** The part of what a guest paid that the platform keeps. Stripe's fees come out of it. */
export const PLATFORM_FEE_RATE = 0.1;

/**
 * How long after check-in the host is paid. A day rather than the check-in itself: a guest
 * who arrives to a place that is not as described has that day to say so, and the money is
 * still the platform's to give back while they do.
 */
export const PAYOUT_DELAY_HOURS = 24;

const IN_UTC = { in: tz("UTC") };

/**
 * The host's part of a stay: what is left after refunds, less the platform's fee, exact to
 * the cent. Counted in whole cents so that 90% of 361.05 is 324.95 rather than
 * 324.94500000000005 — the rounding is half up, in the host's favour.
 */
export function hostShare(amount: number, refunded: number): number {
  const kept = Math.max(
    0,
    Math.round(amount * 100) - Math.round(refunded * 100),
  );
  // A whole percentage, so the product is an integer over 100 and the half that rounds up
  // is an exact half rather than whichever side of it binary noise left it on.
  const hostPercent = Math.round((1 - PLATFORM_FEE_RATE) * 100);

  return Math.round((kept * hostPercent) / 100) / 100;
}

/**
 * When a stay's payout falls due: `PAYOUT_DELAY_HOURS` after midnight UTC of its check-in
 * day — the clock every other rule about a calendar day here reads.
 */
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

/**
 * `POST /payouts/account/session` — what the browser initialises Stripe's embedded
 * components with. Short-lived and good for that one account only, so it is asked for
 * whenever the components need one rather than stored.
 */
export const accountSessionSchema = z.object({
  clientSecret: z.string().min(1),
});

export type HostAccountStatus = z.infer<typeof hostAccountStatusSchema>;
export type HostAccount = z.infer<typeof hostAccountSchema>;
export type AccountSession = z.infer<typeof accountSessionSchema>;
