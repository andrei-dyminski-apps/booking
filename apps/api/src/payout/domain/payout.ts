import { DisputeStatus, owedToHost as owedToHostOf } from "@repo/contracts";
import type { StayMoney } from "../../booking/domain/booking.types";
import type { Cents } from "../../payment/domain/money";

/**
 * What the host is owed is the contract's rule (`owedToHost`), which the admin's screen of
 * stuck payouts states too; this adds what only the API decides: nothing leaves while a
 * dispute is open.
 */
export type PayoutFacts = StayMoney & {
  paid: boolean;
  disputeStatus: DisputeStatus | null;
};

/** What the host should end up holding — the contract's rule over the row's facts. */
export function owedToHost(facts: PayoutFacts): Cents {
  return owedToHostOf({ ...facts, dispute: facts.disputeStatus });
}

export function mayPayOut(facts: PayoutFacts): boolean {
  return facts.disputeStatus !== DisputeStatus.OPEN && owedToHost(facts) > 0;
}
