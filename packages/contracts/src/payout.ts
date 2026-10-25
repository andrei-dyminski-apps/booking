import { tz } from "@date-fns/tz";
import { addHours, parseISO } from "date-fns";
import { z } from "zod";

/**
 * Here for the reason `refundOnCancel` is: the API transfers by it and the host's screens
 * state it. The host is paid once the stay has begun, so until then a cancellation takes
 * nothing back from anybody.
 */

/** Stripe's fees come out of it. */
export const PLATFORM_FEE_RATE = 0.1;

/** A guest who arrives to a place not as described has that day to say so. */
export const PAYOUT_DELAY_HOURS = 24;

const IN_UTC = { in: tz("UTC") };

/** In whole cents, so 90% of 361.05 is 324.95; rounded half up, in the host's favour. */
export function hostShare(amount: number, refunded: number): number {
  const kept = Math.max(
    0,
    Math.round(amount * 100) - Math.round(refunded * 100),
  );
  // A whole percentage, so a half that rounds up is an exact half, not binary noise.
  const hostPercent = Math.round((1 - PLATFORM_FEE_RATE) * 100);

  return Math.round((kept * hostPercent) / 100) / 100;
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
