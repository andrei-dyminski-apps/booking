import { tz } from "@date-fns/tz";
import { addDays, format, parseISO, startOfDay } from "date-fns";
import { z } from "zod";

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
 * The zone a listing saved without one is in — the database's default, and what every
 * listing and booking from before the time zones was backfilled with.
 */
export const DEFAULT_TIME_ZONE = "UTC";

/**
 * The check-in time a listing saved without one gets — the database's default. The rows from
 * before the time zones were backfilled with `00:00` instead, so they kept midnight UTC.
 */
export const NEW_LISTING_CHECK_IN_TIME = "15:00";

/**
 * A region's name (`Europe/Berlin`, `Pacific/Kiritimati`) or `UTC`, never an offset: an
 * offset does not follow a change to summer time. The shape is read off the name as typed,
 * not off what `Intl` resolves it to, because `Intl` resolves an offset to a region: `EST`
 * is `America/Panama` to it and `CET` is `Europe/Brussels`, and a New York host who typed
 * `EST` would arrive an hour off all summer. So a name without a region is refused, `GMT`
 * included (London is not on it in summer), and so are the `Etc/GMT±N` names — offsets
 * spelled as regions — and `+05:00`, which newer runtimes accept.
 */
const REGION_NAME = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/;

/** The two spellings of UTC itself, which is a zone with no summer time rather than an offset. */
const UTC_NAMES = new Set(["utc", "etc/utc"]);

/**
 * The names V8 resolves a zone to that IANA has since renamed. `Intl` answers with CLDR's
 * identifiers, and CLDR never changes one once it is published, so `Asia/Kolkata` comes back
 * as `Asia/Calcutta` and `Europe/Kyiv` as `Europe/Kiev`. Each is put back to the name IANA
 * gives it today, which is the one a host would recognise. Only renames are listed, not the
 * zones of their own a country keeps (`Europe/Bratislava` is not `Europe/Prague`); a rename
 * missing here only leaves the older spelling, which every runtime still knows.
 */
const RENAMED_ZONES: Readonly<Record<string, string>> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/**
 * Each stored name's older spelling, lower-cased — the way back from `RENAMED_ZONES`. IANA
 * keeps every old name as a link for good, so a runtime whose zone data predates a rename
 * (an older browser, which may not know `Europe/Kyiv`) still knows the zone by it.
 */
const OLDER_SPELLINGS: ReadonlyMap<string, string> = new Map(
  Object.entries(RENAMED_ZONES).map(([older, renamed]) => [
    renamed.toLowerCase(),
    older,
  ]),
);

/** The name this runtime's `Intl` resolves `zone` to, or `null` when it knows no such zone. */
function resolvedName(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** `zone` itself when this runtime knows it, else its older spelling when it knows that. */
function knownSpelling(zone: string): string | null {
  if (resolvedName(zone) !== null) return zone;

  const older = OLDER_SPELLINGS.get(zone.toLowerCase());

  return older !== undefined && resolvedName(older) !== null ? older : null;
}

/**
 * Memoized by the stored names alone, of which there are a few hundred: a typed one goes
 * through `canonicalTimeZone`, uncached, so a request cannot grow this.
 */
const runtimeSpellings = new Map<string, string | null>();

/**
 * The spelling of a stored zone this runtime converts with: the name itself, or the older
 * one IANA keeps as a link to it when the runtime's zone data predates the rename — so a
 * listing stored as `Europe/Kyiv` reads the same in a browser that only knows
 * `Europe/Kiev`. `null` for a zone newer than the runtime's data altogether; the API never
 * meets one, since its own `Intl` accepted every name it stored. Every rule here converts
 * through it, and so does a page that states a moment in the zone.
 */
export function runtimeTimeZone(zone: string): string | null {
  const known = runtimeSpellings.get(zone);

  if (known !== undefined) return known;

  const spelling = knownSpelling(zone);

  runtimeSpellings.set(zone, spelling);

  return spelling;
}

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

/**
 * The name a listing stores, or `null` for an unknown zone or an offset. It has to be one
 * this runtime's `Intl` knows — under its own name or, for a zone renamed since the
 * runtime's data, the older one — and it is stored as `Intl` resolves it, a renamed zone
 * under its name of today: `europe/berlin` becomes `Europe/Berlin`, `US/Eastern` becomes
 * `America/New_York`, `Asia/Calcutta` becomes `Asia/Kolkata`, `Etc/UTC` becomes `UTC`. The
 * API's runtime decides it; a browser only checks a form with it, since what a response
 * carries is read as it is.
 */
export function canonicalTimeZone(value: string): string | null {
  const typed = value.trim();
  const spelling = knownSpelling(typed);
  const name = spelling === null ? null : resolvedName(spelling);

  if (name === null) return null;

  if (UTC_NAMES.has(typed.toLowerCase())) return DEFAULT_TIME_ZONE;

  if (
    !REGION_NAME.test(typed) ||
    typed.toLowerCase().startsWith("etc/") ||
    !REGION_NAME.test(name) ||
    name.startsWith("Etc/")
  ) {
    return null;
  }

  return RENAMED_ZONES[name] ?? name;
}

export function isTimeZone(value: string): boolean {
  return canonicalTimeZone(value) !== null;
}

/** A zone a listing is saved with: checked, and rewritten to the name it is stored under. */
export const timeZoneSchema = z
  .string({ error: "A time zone is required" })
  .trim()
  .min(1, { error: "A time zone is required" })
  .refine(isTimeZone, {
    error: "A time zone has to be a region such as Europe/Berlin, or UTC",
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
  .string({ error: "A check-in time is required" })
  .regex(CLOCK, { error: "A check-in time has to be written as HH:mm" });

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
