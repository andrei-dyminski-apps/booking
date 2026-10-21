import { tz } from "@date-fns/tz";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { z } from "zod";
import { dayMessage, isDay, today } from "./day.js";
import { blank, PAGING } from "./query.js";

/**
 * What a single night may cost, in the currency itself. High enough that no real nightly
 * rate reaches it, low enough that a misplaced decimal point still does — which is the
 * only thing a ceiling on a price can usefully catch.
 *
 * The column carries the same number as a `CHECK` constraint
 * (`listings_price_within_contract`), and that is what keeps the two ends honest: this
 * schema guards every price that arrives over HTTP, and the constraint guards the writes
 * that never pass through it — the seed, a migration, an import — so a row this schema
 * would refuse to read back cannot be stored in the first place. Raising the ceiling means
 * raising both, in one change; `numeric(10, 2)` has room for two orders of magnitude more
 * than this and needs no migration of its own until that runs out.
 */
const MAX_PRICE = 1_000_000;

/**
 * The same number as a person reads it. The locale is named rather than left to the
 * runtime for the reason the frontend's own formatter names one: a message assembled on
 * the server and a message assembled in the browser have to come out identically.
 */
const MAX_PRICE_LABEL = MAX_PRICE.toLocaleString("en-US");

/**
 * How many guests a listing may sleep. It is a bound on two fields rather than one — the
 * capacity of a listing, and the `guests` a search filters by — and they are the same
 * question asked from either end, so the number is written once.
 */
const MAX_CAPACITY = 50;

/**
 * How many decimal places a price may be exact to — the `2` of `numeric(10, 2)`, and the
 * cent the rules below refuse to go finer than.
 */
const SCALE = 2;

/**
 * A price as the currency itself writes it: `120`, `120.5` and `120.50` are one amount and
 * `120.505` is not one at all. Anything finer than a cent is refused here rather than
 * rounded, because rounding it would store a price nobody typed and answer a form that
 * asked for one with a silent correction.
 *
 * The comparison goes through the decimal spelling rather than through `amount * 100`,
 * because the input is a `number` and `120.35 * 100` is `12034.999999999998` in binary
 * floating point — so that form needs a tolerance to tell a rounding error from a third
 * decimal, and the tolerance is a number picked against the ceiling of the day: the error
 * of a double grows with the value it holds, and one chosen for a price of ten thousand
 * has to be chosen again the next time the ceiling moves. `toFixed` needs none. It is the
 * amount as the cent scale writes it, and a double that survives the round trip through it
 * is the nearest one to a two-decimal number — which is exactly what the column stores.
 */
const cents = (amount: number): boolean =>
  Number(amount.toFixed(SCALE)) === amount;

/**
 * The two rules every price on this contract obeys, as checks rather than as a wrapper
 * schema: `.check(...MONEY)` leaves each of them a plain number schema, so the one the
 * catalogue coerces out of a query string and the one a body carries stay the kinds they
 * are and the API still reads a price off `listingSchema.shape` to validate a cursor with.
 */
const MONEY = [
  z.lte(MAX_PRICE, {
    error: `A price may not be above ${MAX_PRICE_LABEL}`,
  }),
  z.refine<number>(cents, {
    error: "A price may not be finer than a cent",
  }),
];

/**
 * What a number field says when what arrived was not a number at all — a box left empty,
 * or text nothing could read as one.
 *
 * Zod's own wording for that is `Invalid input: expected number, received undefined`,
 * which names the type system rather than the thing being asked for. It reaches two
 * audiences that both deserve better: the API answers a malformed body with it, and the
 * browser puts it under the box as the field is left, because a form here validates
 * against this very schema before it sends anything.
 *
 * `invalid_type` needs a callback where every other rule takes a plain `message`, and that
 * is the whole reason this exists: a bound is one rule with one thing to say, while "not a
 * number" covers both a box left empty and text nothing could read. Returning `undefined`
 * for anything else hands the issue back to the message its own rule gave it.
 */
const numberMessage =
  (missing: string, notANumber: string) =>
  (issue: z.core.$ZodRawIssue): string | undefined => {
    if (issue.code !== "invalid_type") return undefined;

    return issue.input === undefined ? missing : notANumber;
  };

/**
 * One night's price, worded after the box it is typed into. The default price of a listing
 * and every exception to it obey the same rules — more than zero, to the cent, under the
 * ceiling — so the rules are written once and only the subject of the sentence differs.
 */
const nightPrice = (subject: string) =>
  z
    .number({
      error: numberMessage(
        `${subject} is required`,
        `${subject} must be a number`,
      ),
    })
    .positive({ error: `${subject} must be more than zero` })
    .check(...MONEY);

/**
 * A place to stay, owned by exactly one account.
 *
 * `pricePerNight` is an amount of the currency itself — 120.50 is a hundred and twenty
 * fifty — and it is exact to the cent: `MONEY` above refuses a third decimal instead of
 * rounding one away. Everything that multiplies it (a stay of several nights) rounds to
 * the cent at the moment it is shown or charged rather than carrying the error onwards.
 * The ceiling is what a single night may cost.
 */
export const listingSchema = z.object({
  id: z.uuid(),
  ownerId: z.uuid(),
  title: z
    .string()
    .trim()
    .min(3, { error: "A title needs at least 3 characters" })
    .max(100, { error: "A title may not be longer than 100 characters" }),
  description: z
    .string()
    .trim()
    .min(10, { error: "A description needs at least 10 characters" })
    .max(2000, {
      error: "A description may not be longer than 2000 characters",
    }),
  pricePerNight: nightPrice("A price per night"),
  capacity: z
    .int({
      error: numberMessage(
        "A capacity is required",
        "A capacity must be a whole number",
      ),
    })
    .min(1, { error: "A listing has to sleep at least one guest" })
    .max(MAX_CAPACITY, {
      error: `A listing may not sleep more than ${String(MAX_CAPACITY)} guests`,
    }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/**
 * The days of the week a price can be set for, Monday first — the order a calendar here
 * draws them in.
 */
export const weekdaySchema = z.enum([
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
]);

const WEEKDAY_PRICE = nightPrice("A weekday price").optional();

/**
 * A price for every night that falls on a given day of the week. A day left out costs the
 * default price; an object rather than a list, because a day can have one price or none
 * and a list would need a rule against naming Friday twice.
 *
 * Strict, unlike the other objects here: a `PATCH` carrying `pricing` replaces the whole
 * set, so a key zod stripped as unknown — `Fri`, `friday` — would be a save that answers
 * `200` and quietly takes every weekday price away.
 */
const weekdayPricesSchema = z.strictObject(
  {
    mon: WEEKDAY_PRICE,
    tue: WEEKDAY_PRICE,
    wed: WEEKDAY_PRICE,
    thu: WEEKDAY_PRICE,
    fri: WEEKDAY_PRICE,
    sat: WEEKDAY_PRICE,
    sun: WEEKDAY_PRICE,
  } satisfies Record<z.infer<typeof weekdaySchema>, typeof WEEKDAY_PRICE>,
  {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? `Not a day of the week: ${issue.keys.join(", ")}`
        : undefined,
  },
);

/**
 * How many single dates a listing may price on its own. A year of them is more than any
 * owner sets by hand, and the bound is what keeps `GET /listings/:id` — public and cached
 * — from carrying a list nobody can see the end of.
 */
const MAX_DATE_PRICES = 366;

/** The night that starts on `date` — the check-in day of a stay, never its check-out. */
const datePriceSchema = z.object({
  date: z.iso.date({
    error: dayMessage(
      "A date is required",
      "A date must be written as YYYY-MM-DD",
    ),
  }),
  price: nightPrice("A price for the date"),
});

/**
 * What a write may set a date price for. Yesterday's price is a rule nobody can meet any
 * more, so a write refuses one; the read does not, because a cached answer outlives the
 * midnight that made one of its dates the past, and refusing to parse it would take the
 * whole listing page down for a night that no longer matters.
 */
const datePriceInputSchema = datePriceSchema.refine(
  (entry) => !isDay(entry.date) || entry.date >= today(),
  { error: "A date price cannot be in the past", path: ["date"] },
);

/**
 * The list of date prices, bounded and with one price per date. Two prices for one night
 * would leave the rule that picks between them to whichever row a query returns first. A
 * row whose date is not a day yet is left to its own message rather than counted.
 */
const datePrices = <Entry extends typeof datePriceSchema>(entry: Entry) =>
  z
    .array(entry)
    .max(MAX_DATE_PRICES, {
      error: `A listing may not price more than ${String(MAX_DATE_PRICES)} dates on their own`,
    })
    .refine(
      (entries) => {
        const days = entries.map(({ date }) => date).filter(isDay);

        return new Set(days).size === days.length;
      },
      { error: "Each date may only have one price" },
    );

/**
 * Every exception to a listing's default price. What a night costs is decided in one
 * order, and it is part of what these fields mean: a price for that very date, then one
 * for its day of the week, then `pricePerNight`. The most specific rule wins because it is
 * the one somebody set deliberately for that night — a holiday is a Friday too.
 * `nightlyPrice` (`pricing.ts`) is that order as code, the one both sides price a night by.
 *
 * The default stays on the listing itself — it is what the catalogue shows, filters and
 * sorts by, and that is why the exceptions travel only with one listing rather than with
 * every row of a page.
 */
export const listingPricingSchema = z.object({
  weekdays: weekdayPricesSchema,
  dates: datePrices(datePriceSchema),
});

/** The same, as a write sets it: `datePriceInputSchema` refuses a date in the past. */
const listingPricingInputSchema = listingPricingSchema.extend({
  dates: datePrices(datePriceInputSchema),
});

/**
 * What a stay names, carried on the booking that names it.
 *
 * A booking outlives the offer it was taken against — retiring a listing leaves the row
 * where it is, precisely so a guest's stay can go on saying where it was — and nothing on
 * the API surface used to resolve it: `GET /listings/:id` answers `404` to everybody once
 * a listing is retired, the guest holding the booking included. Rather than personalising
 * that read, which is public and cached by URL, the booking answers the question itself:
 * the title and the price are what a "my bookings" row shows, and they are read whether or
 * not the listing is still offered. `listingId` next to it stays the identifier, so the
 * summary carries no `id` of its own.
 */
export const listingSummarySchema = listingSchema.pick({
  title: true,
  pricePerNight: true,
});

/**
 * One listing as its own page reads it: the row, and every exception to its default
 * price. Only `GET /listings/:id` answers with it — a page of the catalogue carries the
 * default alone, and the exceptions are what a guest choosing dates on one listing needs.
 */
export const listingDetailSchema = listingSchema.extend({
  pricing: listingPricingSchema,
});

/**
 * `ownerId` is omitted rather than optional: the owner is the signed-in user, taken from
 * the session on the server. Accepting it from the client would make the field a way to
 * create a listing in somebody else's name — the same reason the price of a stay is
 * computed by the server in phase 6 instead of being sent along with the booking.
 */
export const createListingSchema = listingSchema
  .omit({
    id: true,
    ownerId: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    /**
     * Optional, and replaced whole when present: a listing created without it costs its
     * default price every night, and a `PATCH` without it leaves the exceptions as they
     * were. A `PATCH` with it is the complete set — a date missing from the list is a date
     * that no longer has a price of its own — because a form shows every exception at
     * once, and a merge would have no way to say that one was taken away.
     */
    pricing: listingPricingInputSchema.optional(),
  });

/**
 * A PATCH body: any subset of the editable fields, but not an empty one — an update that
 * changes nothing is a mistake on the caller's side rather than a no-op worth storing.
 */
export const updateListingSchema = createListingSchema
  .partial()
  .refine((listing) => Object.keys(listing).length > 0, {
    error: "At least one field must be provided",
  });

export const listingListSchema = z.array(listingSchema);

/**
 * How the catalogue is ordered, as the client asks for it. Four values rather than a field
 * and a direction: the two halves are not independent — the tiebreaker of a keyset page
 * has to follow the direction of the key it breaks ties in, or one btree can no longer
 * answer both ways round — so what a client picks is the whole ordering, and the index
 * behind each one is the server's business.
 *
 * `newest` is the default because a catalogue with nothing asked of it shows what has just
 * appeared; the pair below orders by what a visitor actually compares listings on.
 */
export const listingSortSchema = z.enum([
  "newest",
  "oldest",
  "priceAsc",
  "priceDesc",
]);

/**
 * The catalogue query, as it arrives in the URL: `searchParams` on the frontend and a
 * query string here, so every value is a string until it is coerced. The filters live
 * there rather than in a body because a search that cannot be linked to is not a search —
 * the same reason this is a `GET`.
 *
 * `from`/`to` filter by availability and are all-or-nothing: one date alone is a half
 * question ("free from the 3rd" until when?), and answering it by guessing the other end
 * would quietly return a different list than the one that was asked for.
 *
 * `ownerId` narrows the catalogue to one owner's listings. It is no secret — every listing
 * already carries its `ownerId` — and it is what the admin's section follows from an
 * account to what that account offers.
 *
 * `cursor` and `limit` are the pair every paged read here takes, so they are spread in
 * from `PAGING` rather than spelled out — what they are and why the cursor travels with
 * the `sort` it was issued under is written down there, once for both resources.
 */
export const listingQuerySchema = z
  .object({
    ownerId: blank(z.uuid().optional()),
    from: blank(z.iso.date().optional()),
    to: blank(z.iso.date().optional()),
    minPrice: blank(
      z.coerce
        .number()
        .nonnegative()
        .check(...MONEY)
        .optional(),
    ),
    maxPrice: blank(
      z.coerce
        .number()
        .positive()
        .check(...MONEY)
        .optional(),
    ),
    guests: blank(z.coerce.number().int().min(1).max(MAX_CAPACITY).optional()),
    sort: blank(listingSortSchema.default("newest")),
    ...PAGING,
  })
  .refine((query) => (query.from === undefined) === (query.to === undefined), {
    error: "Filtering by dates needs both a check-in and a check-out date",
    path: ["to"],
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      query.from < query.to,
    {
      error: "Check-out date must be later than check-in date",
      path: ["to"],
    },
  )
  .refine(
    (query) =>
      query.minPrice === undefined ||
      query.maxPrice === undefined ||
      query.minPrice <= query.maxPrice,
    {
      error: "The lowest price must not be above the highest",
      path: ["maxPrice"],
    },
  );

/**
 * One page of the catalogue. `nextCursor` is `null` on the last page — the client asks for
 * the next one by handing it back, and never by counting rows: an offset shifts under a
 * listing published while somebody is paging, and a keyset cursor does not.
 */
export const listingPageSchema = z.object({
  items: listingListSchema,
  nextCursor: z.string().nullable(),
});

/**
 * The window a calendar asks about. Both dates are required: there is nothing to draw
 * otherwise.
 *
 * The ceiling on its width is the same parameter `limit` is on the catalogue — the one a
 * client could use to ask for everything at once. This read is public and answers with
 * every stay it finds, so without a bound `?from=0001-01-01&to=9999-12-31` is a request
 * for the whole booking history of a listing. A year is more than any calendar draws.
 */
const MAX_WINDOW_NIGHTS = 366;

const IN_UTC = { in: tz("UTC") };

/** Whole nights between two `YYYY-MM-DD` dates, both read as days in UTC. */
const nights = (from: string, to: string): number =>
  differenceInCalendarDays(
    parseISO(to, IN_UTC),
    parseISO(from, IN_UTC),
    IN_UTC,
  );

export const availabilityQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine((window) => window.from < window.to, {
    error: "The end of the window must be later than its start",
    path: ["to"],
  })
  .refine(
    (window) =>
      window.from >= window.to ||
      nights(window.from, window.to) <= MAX_WINDOW_NIGHTS,
    {
      error: `The window may not be wider than ${String(MAX_WINDOW_NIGHTS)} nights`,
      path: ["to"],
    },
  );

/** A stay's nights, check-out exclusive — the same half-open range the database excludes on. */
export const bookedRangeSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
});

/**
 * When a listing is taken, for the window that was asked about. Only the ranges that still
 * hold their slot are here — a cancelled stay and a lapsed hold are free nights again —
 * and a range that reaches past either end of the window is returned whole rather than
 * clipped, because a calendar drawing the last day needs to know the stay continues.
 */
export const listingAvailabilitySchema = z.object({
  listingId: z.uuid(),
  from: z.iso.date(),
  to: z.iso.date(),
  booked: z.array(bookedRangeSchema),
});

export type Listing = z.infer<typeof listingSchema>;
export type ListingDetail = z.infer<typeof listingDetailSchema>;
export type ListingPricing = z.infer<typeof listingPricingSchema>;
export type Weekday = z.infer<typeof weekdaySchema>;
export type ListingSort = z.infer<typeof listingSortSchema>;
export type ListingSummary = z.infer<typeof listingSummarySchema>;
export type ListingQuery = z.infer<typeof listingQuerySchema>;
export type ListingPage = z.infer<typeof listingPageSchema>;
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
export type BookedRange = z.infer<typeof bookedRangeSchema>;
export type ListingAvailability = z.infer<typeof listingAvailabilitySchema>;
export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
