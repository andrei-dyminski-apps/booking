/**
 * A calendar day is a `YYYY-MM-DD` string on both sides of the wire — that is what the
 * contract carries and what `@db.Date` stores — so everything here works on that string
 * and never on a local `Date`. Midnight UTC is the instant each of them names. Which
 * check-in day is already gone is the listing's to say (`isCheckInDayPast` in the
 * contract), not this file's.
 *
 * Parsing a day into the runtime's own time zone instead would be wrong twice over: it
 * moves a stay by a day for anybody west of Greenwich, and it makes the server and the
 * browser disagree about the same string, which React reports as a hydration error
 * rather than as the bug it is.
 */

import { tz } from "@date-fns/tz";
import {
  canonicalTimeZone,
  DEFAULT_TIME_ZONE,
  runtimeTimeZone,
  type Weekday,
} from "@repo/contracts";
import {
  addDays as addDaysTo,
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
} from "date-fns";
import { TIME_ZONE_COOKIE } from "../../config";

const IN_UTC = { in: tz("UTC") };

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const DAY_FORMAT = "yyyy-MM-dd";

/**
 * Today in UTC, the way the contract means it. It is computed on the server and handed to
 * a client component as a prop rather than being called on both sides: the two would only
 * ever differ for the render that straddles midnight, and that is exactly the render the
 * difference would be reported on.
 */
export function today(): string {
  return format(new Date(), DAY_FORMAT, IN_UTC);
}

export function addDays(day: string, days: number): string {
  return format(addDaysTo(startOf(day), days), DAY_FORMAT);
}

/** How many nights a stay is: check-out is exclusive, so it is the plain difference. */
export function nightsBetween(from: string, to: string): number {
  return differenceInCalendarDays(startOf(to), startOf(from), IN_UTC);
}

/**
 * Whether a string is a day this module can work with. What reaches here comes out of a
 * URL and out of a date input, and a browser with no date input hands over free text.
 */
export function isDay(value: string): boolean {
  return DAY_PATTERN.test(value) && isValid(startOf(value));
}

/**
 * A day of the week for a person to read, keyed by the contract's own names — the keys a
 * listing's weekday prices are stored under. Written out rather than asked of `Intl`: the
 * contract's week starts on Monday and the names never change with the date.
 */
export const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** A day for a person to read. Fixed locale and time zone, for the reason above. */
export function formatDay(day: string): string {
  return dayFormat.format(startOf(day));
}

/**
 * A day formatted for a chip, or the words "any date" for the empty half of a range. A
 * value that is not a `YYYY-MM-DD` day is handed back as it was typed: it reached the
 * screen out of a URL, and the chip's job is to name what was asked for so it can be taken
 * off again. Both search screens carry a date range, so this is the one spelling of it.
 */
export function dayLabelOrAny(value: string): string {
  if (value === "") return "any date";

  return isDay(value) ? formatDay(value) : value;
}

/**
 * The day an instant falls on, on a given clock. `formatDay` takes the day itself — this
 * one takes a moment the API stamped a row with (`createdAt`), where the time of day is
 * noise on a screen that is only saying when something started. Which day that is depends
 * on the clock: an account's is the reader's (`readerTimeZone`), so an evening sign-up in
 * Honolulu joined on that day there, while a public cached page has no reader to ask and
 * passes UTC. A zone this runtime cannot read at all is taken as UTC, like
 * `formatMomentIn` does, with no name to say so — a day carries none.
 */
export function formatDate(moment: string, timeZone: string): string {
  return zonedFormat(
    zonedDateFormats,
    DATE_PARTS,
    runtimeTimeZone(timeZone) ?? DEFAULT_TIME_ZONE,
  ).format(new Date(moment));
}

/** A moment in UTC, for `formatMomentIn` to name as such. */
function formatMoment(moment: string): string {
  return momentFormat.format(new Date(moment));
}

/**
 * A moment on a given clock, its zone named after it. A stay's moments are stated on its
 * listing's — every date of a cancellation or a refund is measured from the moment of
 * check-in there (`checkInInstant`) — and an account's on the reader's (`readerTimeZone`).
 * The zone is written into the text rather than left to the reader's runtime, so the
 * server and the browser spell it identically, and it is the name the API stored even
 * where this runtime converts by an older one (`runtimeTimeZone`). A zone newer than this
 * runtime's data altogether is stated in UTC, named as such, which is still the same
 * moment.
 */
export function formatMomentIn(moment: string, timeZone: string): string {
  const spelling = runtimeTimeZone(timeZone);

  return spelling === null
    ? `${formatMoment(moment)} UTC`
    : `${zonedFormat(zonedMomentFormats, MOMENT_PARTS, spelling).format(new Date(moment))} ${zoneLabel(timeZone)}`;
}

/**
 * A fixed offset IANA spells as a region, with POSIX's sign — `Etc/GMT-3` is three hours
 * ahead of UTC. A listing is never stored in one (`canonicalTimeZone` refuses it: an offset
 * does not follow summer time), but a reader's clock may be on one, and then it is right.
 */
const OFFSET_ZONE = /^Etc\/GMT([+-])(\d{1,2})$/;

/** A zone as the text names it: an offset zone as the `UTC+3` a person reads, not `Etc/GMT-3`. */
function zoneLabel(timeZone: string): string {
  const [, sign, hours] = OFFSET_ZONE.exec(timeZone) ?? [];

  if (sign === undefined || hours === undefined) return timeZone;

  const offset = Number(hours);

  return offset === 0 ? "UTC" : `UTC${sign === "-" ? "+" : "-"}${offset}`;
}

/**
 * The zone an account's moments are stated in — the notices, the messages, "Blocked
 * since", a host's fees, the admin's lists, a hold's deadline. They have no place of their
 * own, so the reader's clock is the right one, and the browser says which it is through a
 * cookie (`TimeZoneCookie` in the shell). A server render reads it here and hands it down
 * as a prop, so the server and the browser format the same text.
 *
 * Only a page that is personal already calls it: `cookies()` makes a render dynamic, and
 * the public cached reads — the catalogue, a listing, its reviews — state no such moment
 * (a review's date is UTC's, `formatDate`).
 * `next/headers` is imported lazily for the reason `http-client.ts` gives.
 */
export async function readerTimeZone(): Promise<string> {
  const { cookies } = await import("next/headers");

  return readerTimeZoneOf((await cookies()).get(TIME_ZONE_COOKIE)?.value);
}

/**
 * The cookie's value as a zone, or UTC — a first visit, before the browser has written it,
 * and anything it should not hold. The browser writes it, so it is checked like a typed
 * one: a region's name this runtime knows (`canonicalTimeZone`), or one of the fixed
 * offsets a reader's clock may be on and a listing's may not (`Etc/GMT-3`). Never a raw
 * `+05:00`, and nothing else reaches `runtimeTimeZone`, whose memo a cookie must not grow:
 * the offsets are a pattern of a couple of hundred values at most.
 */
export function readerTimeZoneOf(value: string | undefined): string {
  if (value === undefined) return DEFAULT_TIME_ZONE;

  const zone = value.trim();

  return (
    canonicalTimeZone(zone) ??
    (OFFSET_ZONE.test(zone) && runtimeTimeZone(zone) !== null
      ? zone
      : DEFAULT_TIME_ZONE)
  );
}

/**
 * The browser's own zone, spelled as the cookie stores it. For a client render nothing on
 * the server drew first — the bell's popup, read when it opens — and for the cookie itself.
 */
export function browserTimeZone(): string {
  return readerTimeZoneOf(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

const MOMENT_PARTS = {
  dateStyle: "medium",
  timeStyle: "short",
} as const satisfies Intl.DateTimeFormatOptions;

const DATE_PARTS = {
  day: "numeric",
  month: "short",
  year: "numeric",
} as const satisfies Intl.DateTimeFormatOptions;

const zonedMomentFormats = new Map<string, Intl.DateTimeFormat>();

const zonedDateFormats = new Map<string, Intl.DateTimeFormat>();

/** One formatter per zone, for a spelling `runtimeTimeZone` has found this runtime knows. */
function zonedFormat(
  formats: Map<string, Intl.DateTimeFormat>,
  parts: Intl.DateTimeFormatOptions,
  timeZone: string,
): Intl.DateTimeFormat {
  const known = formats.get(timeZone);

  if (known !== undefined) return known;

  const made = new Intl.DateTimeFormat("en-GB", { ...parts, timeZone });

  formats.set(timeZone, made);

  return made;
}

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  ...DATE_PARTS,
  timeZone: "UTC",
});

const momentFormat = new Intl.DateTimeFormat("en-GB", {
  ...MOMENT_PARTS,
  timeZone: "UTC",
});

function startOf(day: string): Date {
  return parseISO(day, IN_UTC);
}
