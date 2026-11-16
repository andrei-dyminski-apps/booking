import {
  canonicalTimeZone,
  DEFAULT_TIME_ZONE,
  runtimeTimeZone,
} from "@repo/contracts";

/*
 * The reader's zone, apart from the date arithmetic in `dates.ts`: the shell asks for the
 * browser's own zone on every page (`TimeZoneCookie`), and that file brings date-fns along.
 */

/**
 * A fixed offset IANA spells as a region, with POSIX's sign — `Etc/GMT-3` is three hours
 * ahead of UTC. A listing is never stored in one (`canonicalTimeZone` refuses it: an offset
 * does not follow summer time), but a reader's clock may be on one, and then it is right.
 */
export const OFFSET_ZONE = /^Etc\/GMT([+-])(\d{1,2})$/;

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
