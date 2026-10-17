/** A badge stops counting here — a number is a nudge, not a ledger. */
const BADGE_CEILING = 99;

/** What a badge draws for `count`: the number, or the ceiling and a plus past it. */
export function badgeCount(count: number): string {
  return count > BADGE_CEILING ? `${String(BADGE_CEILING)}+` : String(count);
}
