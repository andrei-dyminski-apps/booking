import { tz } from "@date-fns/tz";
import { addDays, parseISO } from "date-fns";

/**
 * The days of a list of what was set aside, as bounds on the moment it was: from the
 * midnight (UTC) the first day starts at up to the one the last day ends at, both days
 * whole. Each end is optional, as the contract allows; no end at all is no bound.
 */
export function setAsideWithin(window: {
  from?: string | undefined;
  to?: string | undefined;
}): { gte?: Date; lt?: Date } {
  const utc = { in: tz("UTC") };

  return {
    ...(window.from === undefined ? {} : { gte: parseISO(window.from, utc) }),
    ...(window.to === undefined
      ? {}
      : { lt: addDays(parseISO(window.to, utc), 1, utc) }),
  };
}
