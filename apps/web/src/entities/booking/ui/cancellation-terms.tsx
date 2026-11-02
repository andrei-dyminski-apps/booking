import type { CancellationPolicy, RefundWindow } from "@repo/contracts";
import {
  CANCELLATION_POLICY_LABELS,
  policySummary,
  policyTerms,
} from "../model/cancellation-policy";
import { RefundScheduleList } from "./refund-schedule-list";

/**
 * A cancellation policy as a person reads it: its name, the one-line summary, and then
 * either the rules in general — on the listing page, before any dates exist — or, handed a
 * stay's `refundSchedule`, the dated windows of that one stay.
 */
export const CancellationTerms = ({
  policy,
  schedule,
}: {
  policy: CancellationPolicy;
  /** A stay's own windows; without them the policy's rules are listed instead. */
  schedule?: RefundWindow[];
}) => (
  <div className="flex flex-col gap-2 text-sm">
    <p>
      <span className="font-medium">{CANCELLATION_POLICY_LABELS[policy]}</span>
      <span className="text-muted-foreground"> · {policySummary(policy)}</span>
    </p>
    {schedule === undefined ? (
      <ul
        role="list"
        className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground"
      >
        {policyTerms(policy).map((term) => (
          <li key={term}>{term}</li>
        ))}
      </ul>
    ) : (
      <RefundScheduleList schedule={schedule} />
    )}
  </div>
);
