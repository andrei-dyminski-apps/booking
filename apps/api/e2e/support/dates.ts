import { TZDate } from "@date-fns/tz";
import { addDays, format } from "date-fns";

/**
 * Check-in may not be in the past (`createBookingSchema`), so a fixture with a date
 * written into it would pass until that date and fail every run after. Everything the
 * specs book is therefore anchored to the day the suite runs.
 *
 * UTC, like the schema: both sides have to pick the same clock or the boundary moves.
 */
export function inDays(days: number): string {
  return format(addDays(TZDate.tz("UTC"), days), "yyyy-MM-dd");
}
