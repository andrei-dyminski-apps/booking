import type { CancellationPolicy, RefundWindow } from "@repo/contracts";
import {
  CANCELLATION_POLICY_LABELS,
  checkInWords,
  policySummary,
  policyTerms,
} from "../model/cancellation-policy";
import { RefundScheduleList } from "./refund-schedule-list";

/**
 * A cancellation policy as a person reads it: its name, the one-line summary, and then
 * either the rules in general — on the listing page, before any dates exist — or, handed a
 * stay's `refundSchedule`, the dated windows of that one stay. Beside them, the check-in
 * every window is measured from, on the listing's own clock.
 */
export const CancellationTerms = ({
  policy,
  checkIn,
  schedule,
}: {
  policy: CancellationPolicy;
  /** The listing's — or the stay's copy of it — time zone and check-in time. */
  checkIn: { timeZone: string; checkInTime: string };
  /** A stay's own windows; without them the policy's rules are listed instead. */
  schedule?: RefundWindow[];
}) => (
  <div className="flex flex-col gap-2 text-sm">
    <p>
      <span className="font-medium">{CANCELLATION_POLICY_LABELS[policy]}</span>
      <span className="text-muted-foreground"> · {policySummary(policy)}</span>
    </p>
    <p className="text-muted-foreground">
      Check-in from {checkInWords(checkIn)}.
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
      <RefundScheduleList schedule={schedule} timeZone={checkIn.timeZone} />
    )}
  </div>
);
