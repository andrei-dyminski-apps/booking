/**
 * Which time zones a listing may be in, and how each runtime spells them. Apart from the
 * conversions in `check-in.ts` because the browser needs it without them: the shell of
 * `apps/web` checks the reader's own zone on every page, and that file brings zod and
 * date-fns along with its schemas and conversions. This one imports nothing.
 */

/**
 * The zone a listing saved without one is in — the database's default, and what every
 * listing and booking from before the time zones was backfilled with.
 */
export const DEFAULT_TIME_ZONE = "UTC";

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
