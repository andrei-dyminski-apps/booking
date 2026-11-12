/**
 * The cookie the browser writes its own time zone into, so a server render can state an
 * account's moments on the reader's clock (`readerTimeZone`). Not `httpOnly`: the browser
 * is what knows the value, and nothing is decided by it beyond how a moment is spelled.
 */
export const TIME_ZONE_COOKIE = "time_zone";

/** A year: the zone is written again whenever it differs, so the age only bounds a stale one. */
export const TIME_ZONE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
