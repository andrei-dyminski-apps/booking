import { tz } from "@date-fns/tz";
import { differenceInCalendarDays, parseISO } from "date-fns";

/**
 * A stay's date range, as the contract speaks it: two `YYYY-MM-DD` strings, check-out
 * exclusive. Day arithmetic through `date-fns`, no Prisma — the repository turns these
 * into `@db.Date` columns, and phase 6 turns `nights` into a price.
 *
 * Whether two ranges overlap is deliberately not here. It is asked in exactly two places,
 * and both of them are the database: the `where` of the check inside the locking
 * transaction and the `EXCLUDE` constraint behind it. A third spelling of the same rule in
 * TypeScript would be one nobody calls and one more place for it to drift.
 */

const IN_UTC = { in: tz("UTC") };

/** Whole nights between check-in and check-out; `daterange` is half-open, so this is exact. */
export function nights(from: string, to: string): number {
  return differenceInCalendarDays(
    parseISO(to, IN_UTC),
    parseISO(from, IN_UTC),
    IN_UTC,
  );
}
