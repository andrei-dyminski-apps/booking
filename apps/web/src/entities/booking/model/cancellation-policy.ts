import {
  BASIS_POINTS,
  CANCELLATION_TERMS,
  CancellationPolicy,
  cancellationPolicySchema,
  GRACE_MIN_LEAD_HOURS,
  GRACE_PERIOD_HOURS,
  type CancellationPolicy as PolicyName,
  type RefundWindow,
} from "@repo/contracts";
import { formatMomentIn } from "#shared/lib";

/**
 * The policies, named for a person. Keyed by the contract's enum, so a sixth policy stops
 * compiling here rather than reaching a select as a blank option.
 */
export const CANCELLATION_POLICY_LABELS: Record<PolicyName, string> = {
  [CancellationPolicy.FLEXIBLE]: "Flexible",
  [CancellationPolicy.MODERATE]: "Moderate",
  [CancellationPolicy.LIMITED]: "Limited",
  [CancellationPolicy.FIRM]: "Firm",
  [CancellationPolicy.NON_REFUNDABLE]: "Non-refundable",
};

export const cancellationPolicyOptions = cancellationPolicySchema.options.map(
  (value) => ({ value, label: CANCELLATION_POLICY_LABELS[value] }),
);

/** `5000` is "50%" — the one spelling of a share as a number, in a label or a sentence. */
export function sharePercent(shareBps: number): string {
  return `${String(shareBps / 100)}%`;
}

/**
 * The moment a refund window closes, as every line and sentence about one states it: on the
 * listing's own clock, the zone named, since the window is measured from check-in there.
 */
export function windowEnd(moment: Date, timeZone: string): string {
  return formatMomentIn(moment.toISOString(), timeZone);
}

/**
 * When a stay may be arrived at, which every window is measured from: "15:00, Europe/Lisbon
 * time".
 */
export function checkInWords(checkIn: {
  timeZone: string;
  checkInTime: string;
}): string {
  return `${checkIn.checkInTime}, ${checkIn.timeZone} time`;
}

/** Whether a share gives back the whole payment — the one threshold every wording reads. */
export function isFullShare(shareBps: number): boolean {
  return shareBps >= BASIS_POINTS;
}

/** A share inside a sentence: "the full amount", "50%". */
export function shareInWords(shareBps: number): string {
  return isFullShare(shareBps) ? "the full amount" : sharePercent(shareBps);
}

/** `10000` is a full refund, `5000` a 50% one, `0` none. */
function refundShareLabel(shareBps: number): string {
  if (isFullShare(shareBps)) return "Full refund";
  if (shareBps <= 0) return "No refund";

  return `${sharePercent(shareBps)} refund`;
}

/** 48 hours stays hours; 120 hours is 5 days. */
function lead(hours: number): string {
  return hours > 48 && hours % 24 === 0
    ? `${String(hours / 24)} days`
    : `${String(hours)} hours`;
}

/**
 * A policy in one line, for a select's option and the listing page's heading. Read off
 * `CANCELLATION_TERMS` rather than written out per policy, so the words cannot promise
 * a window the API does not refund by.
 */
export function policySummary(policy: PolicyName): string {
  const [first, ...rest] = CANCELLATION_TERMS[policy].tiers;

  if (first === undefined) return "No refund on cancellation";

  // "Full refund until 14 days before check-in, 50% refund until 7 days".
  return [
    `${refundShareLabel(first.shareBps)} until ${lead(first.hoursBefore)} before check-in`,
    ...rest.map(
      (tier) =>
        `${refundShareLabel(tier.shareBps)} until ${lead(tier.hoursBefore)}`,
    ),
  ].join(", ");
}

/**
 * Every rule of a policy as a sentence, the grace period included — what the listing page
 * and the stay's page list under the policy's name. The windows are measured to the moment
 * of check-in on the listing's own clock, which `CancellationTerms` states beside them.
 */
export function policyTerms(policy: PolicyName): string[] {
  const { tiers, grace } = CANCELLATION_TERMS[policy];

  if (tiers.length === 0) {
    return ["A cancellation refunds nothing, however early it comes."];
  }

  return [
    ...tiers.map(
      (tier) =>
        `${refundShareLabel(tier.shareBps)} for a cancellation more than ${lead(tier.hoursBefore)} before check-in.`,
    ),
    "No refund after that.",
    ...(grace
      ? [
          `Cancelled within ${lead(GRACE_PERIOD_HOURS)} of booking, a stay refunds in full as long as check-in is more than ${lead(GRACE_MIN_LEAD_HOURS)} away.`,
        ]
      : []),
  ];
}

/**
 * A stay's schedule as dated lines — `refundSchedule` worded: what a cancellation before
 * each moment gives back, and the last line for after them all.
 */
export function scheduleLines(
  windows: RefundWindow[],
  timeZone: string,
): { key: string; when: string; refund: string }[] {
  return [
    ...windows.map((window) => ({
      key: window.until.toISOString(),
      when: `Before ${windowEnd(window.until, timeZone)}`,
      refund: refundShareLabel(window.shareBps),
    })),
    {
      key: "after",
      when: windows.length === 0 ? "At any time" : "After that",
      refund: refundShareLabel(0),
    },
  ];
}
