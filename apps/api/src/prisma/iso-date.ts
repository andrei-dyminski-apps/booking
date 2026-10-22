import { tz } from "@date-fns/tz";
import { format } from "date-fns";

/**
 * A `@db.Date` column arrives as a Date at UTC midnight, so formatting in UTC is exact.
 *
 * It lives beside the client rather than in one repository because two of them map those
 * columns onto the contract's `YYYY-MM-DD` days — the stays and the waitlist — and the two
 * have to agree about what day a row is.
 */
export function toIsoDate(date: Date): string {
  return format(date, "yyyy-MM-dd", { in: tz("UTC") });
}

/** Midnight UTC of the current day — the clock `createBookingSchema` compares a check-in to. */
export function startOfToday(now: Date): Date {
  return new Date(toIsoDate(now));
}
