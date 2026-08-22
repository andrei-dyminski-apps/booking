/**
 * Check-in may not be in the past (`createBookingSchema`), so a fixture with a date
 * written into it would pass until that date and fail every run after. Everything the
 * specs book is therefore anchored to the day the suite runs.
 *
 * UTC, like the schema: both sides have to pick the same clock or the boundary moves.
 */
export function inDays(days: number): string {
  const date = new Date();

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}
