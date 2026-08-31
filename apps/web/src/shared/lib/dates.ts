/**
 * A calendar day is a `YYYY-MM-DD` string on both sides of the wire — that is what the
 * contract carries and what `@db.Date` stores — so everything here works on that string
 * and never on a local `Date`. Midnight UTC is the instant each of them names, which is
 * the clock `createBookingSchema` compares a check-in against.
 *
 * Parsing a day into the runtime's own time zone instead would be wrong twice over: it
 * moves a stay by a day for anybody west of Greenwich, and it makes the server and the
 * browser disagree about the same string, which React reports as a hydration error
 * rather than as the bug it is.
 */

const MS_PER_DAY = 86_400_000;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Today in UTC, the way the contract means it. It is computed on the server and handed to
 * a client component as a prop rather than being called on both sides: the two would only
 * ever differ for the render that straddles midnight, and that is exactly the render the
 * difference would be reported on.
 */
export function today(): string {
  return toDay(new Date());
}

export function addDays(day: string, days: number): string {
  return toDay(new Date(startOf(day) + days * MS_PER_DAY));
}

/** How many nights a stay is: check-out is exclusive, so it is the plain difference. */
export function nightsBetween(from: string, to: string): number {
  return Math.round((startOf(to) - startOf(from)) / MS_PER_DAY);
}

/**
 * Whether a string is a day this module can work with. What reaches here comes out of a
 * URL and out of a date input, and a browser with no date input hands over free text.
 */
export function isDay(value: string): boolean {
  return DAY_PATTERN.test(value) && !Number.isNaN(startOf(value));
}

/** A day for a person to read. Fixed locale and time zone, for the reason above. */
export function formatDay(day: string): string {
  return dayFormat.format(new Date(startOf(day)));
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
 * The day an instant falls on, in UTC. `formatDay` takes the day itself — this one takes
 * a moment the API stamped a row with (`createdAt`), where the time of day is noise on a
 * screen that is only saying when something started.
 */
export function formatDate(moment: string): string {
  return dayFormat.format(new Date(moment));
}

/**
 * A moment for a person to read, stated in UTC because that is the only clock this
 * application can render the same way twice. The label that carries it says so.
 */
export function formatMoment(moment: string): string {
  return momentFormat.format(new Date(moment));
}

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const momentFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function startOf(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function toDay(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}
