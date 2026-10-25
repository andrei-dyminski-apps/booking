import { hostShare, type DisputeStatus } from "@repo/contracts";

/**
 * The share itself is `hostShare` from the contract, which the host's screens state too;
 * this adds what only the API knows: a dispute, and whether the money ever arrived.
 */
export type PayoutFacts = {
  amount: number;
  refundedAmount: number | null;
  refundOwed: number | null;
  paid: boolean;
  disputeStatus: DisputeStatus | null;
};

/**
 * What the host should end up holding. A lost dispute took the money back from the
 * platform, and the host's share with it; an open one only holds back sending (`mayPayOut`).
 */
export function owedToHost(facts: PayoutFacts): number {
  if (!facts.paid || facts.disputeStatus === "LOST") return 0;

  // A refund owed is the guest's money already; paying it out would only be taken back.
  return hostShare(
    facts.amount,
    (facts.refundedAmount ?? 0) + (facts.refundOwed ?? 0),
  );
}

export function mayPayOut(facts: PayoutFacts): boolean {
  return facts.disputeStatus !== "OPEN" && owedToHost(facts) > 0;
}
