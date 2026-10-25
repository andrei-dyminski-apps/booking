import { hostShare } from "@repo/contracts";

/**
 * What the host of a stay is owed, and whether it can be sent — pure functions, no Nest, no
 * Prisma. The share itself is `hostShare` from the contract, which the host's screens state
 * as well; this file adds the two things only the API knows about: a dispute, and whether
 * the guest's money ever arrived.
 */

/** Where a dispute of the payment stands, as `bookings.dispute_status` stores it. */
export type DisputeState = "OPEN" | "WON" | "LOST";

/** The columns of a stay the rule reads. */
export type PayoutFacts = {
  amount: number;
  refundedAmount: number | null;
  /** What a cancellation is giving back and has not sent yet; counted as refunded. */
  refundOwed: number | null;
  /** A payment confirmed the stay — whatever its status is now. */
  paid: boolean;
  disputeStatus: DisputeState | null;
};

/**
 * What the host should end up holding of this stay. Nothing for a stay nobody paid for, and
 * nothing once a dispute is lost: the bank took the money back from the platform, and the
 * host's share went with it. An open dispute still owes the share — it only holds back
 * sending it (`mayPayOut`), and a transfer already sent is left alone until the outcome.
 */
export function owedToHost(facts: PayoutFacts): number {
  if (!facts.paid || facts.disputeStatus === "LOST") return 0;

  // A refund the guest is owed is the guest's money already: paying it out to the host in
  // the moment before it is sent would only be a transfer to take back straight after.
  return hostShare(
    facts.amount,
    (facts.refundedAmount ?? 0) + (facts.refundOwed ?? 0),
  );
}

/** Whether a transfer may leave now: something is owed, and no dispute is still open. */
export function mayPayOut(facts: PayoutFacts): boolean {
  return facts.disputeStatus !== "OPEN" && owedToHost(facts) > 0;
}
