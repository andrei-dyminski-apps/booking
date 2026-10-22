import { tz } from "@date-fns/tz";
import type { BookedRange } from "@repo/contracts";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getISODay,
  parseISO,
  startOfMonth,
} from "date-fns";

const IN_UTC = { in: tz("UTC") };

/** One cell of the calendar. A day is either on offer, already taken, or behind us. */
export type CalendarDay = {
  day: string;
  taken: boolean;
  past: boolean;
};

export type CalendarMonth = {
  label: string;
  /** Empty cells before the 1st, so it lands under the weekday it falls on. */
  offset: number;
  days: CalendarDay[];
};

/**
 * The window the API answered about, laid out as months.
 *
 * The one rule worth stating is the comparison: a range is half-open, `from` inclusive and
 * `to` exclusive, because a night is what a stay takes and the check-out day is not one.
 * That is the same `[)` the database excludes on and the same strict inequality the
 * locking transaction compares with, so a stay ending on the 9th and one starting on it
 * are drawn back to back rather than as a conflict.
 *
 * A range reaching past either end of the window arrives whole rather than clipped, which
 * is what lets the last drawn day know the nights continue; the comparison below needs no
 * special case for it.
 *
 * The days are `YYYY-MM-DD` strings throughout and compare lexicographically, so nothing
 * here parses one into a local `Date` — see `shared/lib/dates.ts` for why that matters.
 */
export function buildMonths(
  anchor: string,
  count: number,
  booked: readonly BookedRange[],
  today: string,
): CalendarMonth[] {
  const start = startOfMonth(parseISO(anchor, IN_UTC));
  const months: CalendarMonth[] = [];

  for (let index = 0; index < count; index += 1) {
    const first = addMonths(start, index);
    const days = eachDayOfInterval(
      { start: first, end: endOfMonth(first) },
      IN_UTC,
    ).map((cursor): CalendarDay => {
      const day = format(cursor, "yyyy-MM-dd");

      return { day, taken: isTaken(day, booked), past: day < today };
    });

    months.push({
      label: monthLabel.format(first),
      // The week starts on Monday here, and the ISO count gives Monday 1.
      offset: getISODay(first) - 1,
      days,
    });
  }

  return months;
}

/** Monday first, matching the offset above. */
export const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

const monthLabel = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function isTaken(day: string, booked: readonly BookedRange[]): boolean {
  return booked.some((range) => range.from <= day && day < range.to);
}

/**
 * Whether a stay from `from` to `to` would take a night the calendar draws as taken — the
 * same half-open comparison, so a stay starting on another's check-out day is not one. It
 * is what the booking form offers the waitlist on rather than a hold, and it is a guess
 * about the window the page read: outside it, or a moment later, the API decides.
 */
export function overlapsBooked(
  from: string,
  to: string,
  booked: readonly BookedRange[],
): boolean {
  return booked.some((range) => range.from < to && from < range.to);
}

/**
 * Whether the booking form offers the waitlist for a stay rather than a hold: the calendar
 * draws one of its nights as taken, or the API refused a hold of exactly these nights. The
 * second is all the form can know about nights past the window the calendar reads — the
 * refresh after that `409` redraws the window and nothing beyond it.
 */
export function callsForWaitlist(
  from: string,
  to: string,
  booked: readonly BookedRange[],
  refused: BookedRange | null,
): boolean {
  return (
    (refused?.from === from && refused.to === to) ||
    overlapsBooked(from, to, booked)
  );
}
