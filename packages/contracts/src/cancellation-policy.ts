import { z } from "zod";
import { BASIS_POINTS } from "./money.js";

/**
 * How much a guest's cancellation of a paid stay gives back, and until when — chosen by the
 * host per listing and copied onto every booking when the hold is taken, so a later change
 * of the listing's policy does not restate a stay already taken. Mirrored by the
 * `CancellationPolicy` enum of the Prisma schema.
 *
 * `FLEXIBLE` is the rule the whole site ran on before policies existed, and every listing
 * and booking from before them carries it.
 */
export const cancellationPolicySchema = z.enum([
  "FLEXIBLE",
  "MODERATE",
  "LIMITED",
  "FIRM",
  "NON_REFUNDABLE",
]);

export const CancellationPolicy = cancellationPolicySchema.enum;

export type CancellationPolicy = z.infer<typeof cancellationPolicySchema>;

/**
 * One window of a schedule: a guest who cancels more than `hoursBefore` hours before
 * check-in is given back `shareBps` of what they paid. The window is "before", not "at or
 * before" — at the very moment it closes, the next one applies.
 */
export type RefundTier = {
  hoursBefore: number;
  shareBps: number;
};

export type CancellationTerms = {
  /** The widest window first. Past the last one a guest's cancellation refunds nothing. */
  tiers: readonly RefundTier[];
  /** What the nights left of a stay ended early give back — `unusedNightsRefund`. */
  unusedNightsBps: number;
  /** Whether the grace period applies — see `GRACE_PERIOD_HOURS`. */
  grace: boolean;
};

const HALF = BASIS_POINTS / 2;
const DAY_HOURS = 24;

/**
 * The terms as data, so the API refunds by the very table the booking page states. Adding
 * a policy is a member of the enum, a row here and a migration of the Prisma enum.
 *
 * **A row is never edited once a booking can carry it.** A booking freezes the policy's
 * name, not its terms, so changing a window here would restate every stay already taken
 * under that name — the very thing copying the policy onto the booking exists to prevent.
 * New terms are a new policy (`FIRM_V2`): a member of the enum, a row here, a migration of
 * the Prisma enum. The listings move to it, the old row stays for the stays that carry it,
 * and it is offered no more. Fixing a wording is not a change of terms; a window, a share,
 * `unusedNightsBps` or `grace` is.
 */
export const CANCELLATION_TERMS: Record<CancellationPolicy, CancellationTerms> =
  {
    FLEXIBLE: {
      tiers: [{ hoursBefore: 48, shareBps: BASIS_POINTS }],
      unusedNightsBps: BASIS_POINTS,
      grace: true,
    },
    MODERATE: {
      tiers: [{ hoursBefore: 5 * DAY_HOURS, shareBps: BASIS_POINTS }],
      unusedNightsBps: HALF,
      grace: true,
    },
    LIMITED: {
      tiers: [
        { hoursBefore: 14 * DAY_HOURS, shareBps: BASIS_POINTS },
        { hoursBefore: 7 * DAY_HOURS, shareBps: HALF },
      ],
      unusedNightsBps: 0,
      grace: true,
    },
    FIRM: {
      tiers: [
        { hoursBefore: 30 * DAY_HOURS, shareBps: BASIS_POINTS },
        { hoursBefore: 7 * DAY_HOURS, shareBps: HALF },
      ],
      unusedNightsBps: 0,
      grace: true,
    },
    NON_REFUNDABLE: {
      tiers: [],
      unusedNightsBps: 0,
      // A discount that is free to undo for a day is not a trade.
      grace: false,
    },
  };

/**
 * The grace period: a booking cancelled within this many hours of being created refunds in
 * full under any policy that has one — provided check-in is still more than
 * `GRACE_MIN_LEAD_HOURS` away, so a stay booked for the coming weekend cannot be held for a
 * day at no cost. "More than", like every tier: at the very moment check-in is that far
 * away, the grace period has ended.
 */
export const GRACE_PERIOD_HOURS = 24;

export const GRACE_MIN_LEAD_HOURS = 7 * DAY_HOURS;
