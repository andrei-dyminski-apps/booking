/**
 * A stay's date range, as the contract speaks it: two `YYYY-MM-DD` strings, check-out
 * exclusive. Pure string/'`Date`' arithmetic, no Prisma — the repository turns these into
 * `@db.Date` columns, and phase 6 turns `nights` into a price.
 *
 * Whether two ranges overlap is deliberately not here. It is asked in exactly two places,
 * and both of them are the database: the `where` of the check inside the locking
 * transaction and the `EXCLUDE` constraint behind it. A third spelling of the same rule in
 * TypeScript would be one nobody calls and one more place for it to drift.
 */

const MS_PER_NIGHT = 24 * 60 * 60 * 1000;

/** Whole nights between check-in and check-out; `daterange` is half-open, so this is exact. */
export function nights(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      MS_PER_NIGHT,
  );
}
