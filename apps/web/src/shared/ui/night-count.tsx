import { MoonIcon } from "lucide-react";
import { countOf, nightsBetween } from "../lib";

/** How many nights a range of days spans, behind a moon. */
export const NightCount = ({ from, to }: { from: string; to: string }) => (
  <span className="flex items-center gap-1.5">
    <MoonIcon className="size-[1em]" />
    {countOf(nightsBetween(from, to), "night")}
  </span>
);
