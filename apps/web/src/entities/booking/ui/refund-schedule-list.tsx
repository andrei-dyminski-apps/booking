import type { RefundWindow } from "@repo/contracts";
import { scheduleLines } from "../model/cancellation-policy";

/**
 * One stay's dated windows, a line each and the last for after them all — what the stay's
 * page lists under its policy and what the listing page quotes for the dates being chosen,
 * drawn in one place so the two cannot word a window differently.
 */
export const RefundScheduleList = ({
  schedule,
  timeZone,
}: {
  schedule: RefundWindow[];
  /** The listing's, which every moment of the schedule is stated in. */
  timeZone: string;
}) => (
  <ul
    role="list"
    className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground"
  >
    {scheduleLines(schedule, timeZone).map((line) => (
      <li key={line.key}>
        {line.when}: <span className="text-foreground">{line.refund}</span>
      </li>
    ))}
  </ul>
);
