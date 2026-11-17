import { tz } from "@date-fns/tz";
import { addDays, format, parseISO, startOfDay } from "date-fns";
import { z } from "zod";
import { rule } from "./error-code.js";
import { canonicalTimeZone, isTimeZone, runtimeTimeZone } from "./time-zone.js";

/**
 * When a stay begins: its check-in day, at the listing's check-in time, in the listing's own
 * time zone. A listing names both, and every booking copies them when the hold is taken —
 * like the policy, so a later change of the listing restates no stay's windows.
 *
 * Every rule measured from the moment of arrival reads it through `checkInInstant`: the
 * refund windows, the host's fee, when a cancellation stops and an early end starts
 * (`isCancellableOn`, `mayEndEarly`) and when the host is paid (`payoutDueAt`). Which check-in
 * day is already gone is the listing's too: its today, not the UTC one (`isCheckInDayPast`).
 * A date price is bounded by the earliest today of any zone (`earliestToday`), so tonight
 * west of Greenwich keeps its price; what belongs to no place — `isReviewable` — stays on
 * UTC days.
 */

/**
 * The check-in time a listing saved without one gets — the database's default. The rows from
 * before the time zones were backfilled with `00:00` instead, so they kept midnight UTC.
 */
export const NEW_LISTING_CHECK_IN_TIME = "15:00";

/**
 * The `in` option of every conversion of a stored zone. A zone this runtime cannot read
 * under any spelling is refused in words rather than turned into an invalid date that
 * fails somewhere further on.
 */
function inZone(zone: string): { in: ReturnType<typeof tz> } {
  const spelling = runtimeTimeZone(zone);

  if (spelling === null) {
    throw new RangeError(`This runtime knows no time zone ${zone}`);
  }

  return { in: tz(spelling) };
}

const TIME_ZONE_REQUIRED = rule(
  "TIME_ZONE_REQUIRED",
  "A time zone is required",
);

/** A zone a listing is saved with: checked, and rewritten to the name it is stored under. */
export const timeZoneSchema = z
  .string({ error: TIME_ZONE_REQUIRED })
  .trim()
  .min(1, { error: TIME_ZONE_REQUIRED })
  // An empty box is already answered by the length check; asking the lookup too would
  // give one box two refusals.
  .refine((value) => value === "" || isTimeZone(value), {
    error: rule(
      "TIME_ZONE_INVALID",
      "A time zone has to be a region such as Europe/Berlin, or UTC",
    ),
  })
  // zod runs this after a failed `refine` too, so an unknown name keeps what was typed
  // and is answered by the refusal above.
  .overwrite((value) => canonicalTimeZone(value) ?? value);

/**
 * A zone as a response carries it: what the API stored, which its `Intl` accepted when the
 * listing was saved. Not checked again on the way in, because the reader's `Intl` is not the
 * API's — a browser with older zone data may not know a name the API does, and refusing it
 * would take down a whole page or list over one field.
 */
export const storedTimeZoneSchema = z.string().min(1);

/** `HH:mm`, on a 24-hour clock — the same pattern the columns' `CHECK`s hold. */
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const checkInTimeSchema = z
  .string({
    error: rule("CHECK_IN_TIME_REQUIRED", "A check-in time is required"),
  })
  .regex(CLOCK, {
    error: rule(
      "CHECK_IN_TIME_INVALID",
      "A check-in time has to be written as HH:mm",
    ),
  });

/** What a rule about the moment of arrival reads off a stay. */
export type CheckIn = { from: string; timeZone: string; checkInTime: string };

/**
 * The moment every window of a cancellation is measured from. A time that does not exist on
 * that day — inside the hour a clock skips into summer time — is moved on by the length of
 * the gap, as the clock is (02:30 on the night 02:00 becomes 03:00 is 03:30), and a time
 * that happens twice, on the night the clock goes back, is the first of the two.
 */
export function checkInInstant(stay: CheckIn): Date {
  // A plain `Date`: a `TZDate` spells even its ISO string its own way.
  return new Date(
    parseISO(
      `${stay.from}T${stay.checkInTime}`,
      inZone(stay.timeZone),
    ).getTime(),
  );
}

/** What a check-in on a day already gone where the listing is, is refused with. */
export const CHECK_IN_DAY_PAST = "Check-in date cannot be in the past";

/**
 * Whether `day` is gone as a check-in day where the listing is: before its today
 * (`stayDay`). A night in Adelaide is over while it is still that day in UTC, and tonight
 * in Honolulu is yesterday in UTC — each is the listing's to say. Read where the listing's
 * zone is known: under the lock that takes the hold, and by the form beside it.
 * `createBookingSchema` knows no listing and refuses only what is gone everywhere
 * (`earliestToday`).
 */
export function isCheckInDayPast(
  listing: Pick<CheckIn, "timeZone">,
  day: string,
  now: Date,
): boolean {
  return day < stayDay(listing, now);
}

/**
 * The moment `day` stops being a check-in day where the listing is — the first moment of the
 * next one there, which `isCheckInDayPast` turns true at. Stored beside what is kept for a
 * day and filtered by a query that cannot convert between zones: the waitlist's entries.
 */
export function checkInDayEnd(
  listing: Pick<CheckIn, "timeZone">,
  day: string,
): Date {
  const clock = inZone(listing.timeZone);

  // A plain `Date`, for the reason `checkInInstant` gives.
  return new Date(
    startOfDay(addDays(parseISO(day, clock), 1, clock), clock).getTime(),
  );
}

/**
 * The calendar day `now` falls on where the listing is — "tonight" of a stay ended early is
 * the listing's night, not the UTC one.
 */
export function stayDay(stay: Pick<CheckIn, "timeZone">, now: Date): string {
  return format(now, "yyyy-MM-dd", inZone(stay.timeZone));
}
