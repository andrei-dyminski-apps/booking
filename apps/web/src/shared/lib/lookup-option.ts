import type { LookupOption } from "@repo/contracts";

/**
 * A row a filter box offers, as one line outside the box: its name, with the hint behind
 * it where the API handed one over. A name is not unique — two guests may share one — so
 * a chip reading only the name would say the same thing for two different filters.
 */
export function lookupOptionText(option: LookupOption): string {
  return option.hint === null
    ? option.label
    : `${option.label} (${option.hint})`;
}
