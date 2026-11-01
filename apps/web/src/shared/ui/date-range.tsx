import { CalendarIcon } from "lucide-react";
import { formatDay } from "../lib";

/**
 * A range of days, first → last, behind a calendar — a stay, a range waited for. The icon
 * follows the text size, so the same line reads right in a card's description and in its
 * title.
 */
export const DateRange = ({ from, to }: { from: string; to: string }) => (
  <span className="flex items-center gap-1.5">
    <CalendarIcon className="size-[1em]" />
    {formatDay(from)} → {formatDay(to)}
  </span>
);
