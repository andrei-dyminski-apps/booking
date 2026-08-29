import { z } from "zod";

/** What a single night may cost, in the currency itself. */
const MAX_PRICE = 10_000;

/** Minor units to the major one — the scale a price is allowed to be exact to. */
const CENTS = 100;

/**
 * A price as the currency itself writes it: `120`, `120.5` and `120.50` are one amount and
 * `120.505` is not one at all. Anything finer than a cent is refused here rather than
 * rounded, because rounding it would store a price nobody typed and answer a form that
 * asked for one with a silent correction.
 *
 * The comparison is written with a tolerance because the input is a `number` and `120.35 *
 * 100` is `12034.999999999998` in binary floating point. A third decimal is off by at
 * least a tenth of a cent, which is eight orders of magnitude above the error of a double
 * at this scale — so the tolerance separates the two rather than blurring them.
 */
const cents = (amount: number): boolean =>
  Math.abs(amount * CENTS - Math.round(amount * CENTS)) < 1e-6;

/**
 * The two rules every price on this contract obeys, as checks rather than as a wrapper
 * schema: `.check(...MONEY)` leaves each of them a plain number schema, so the one the
 * catalogue coerces out of a query string and the one a body carries stay the kinds they
 * are and the API still reads a price off `listingSchema.shape` to validate a cursor with.
 */
const MONEY = [
  z.lte(MAX_PRICE),
  z.refine<number>(cents, {
    message: "A price may not be finer than a cent",
  }),
];

/**
 * A place to stay, owned by exactly one OWNER.
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
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().min(10).max(2000),
  pricePerNight: z
    .number()
    .positive()
    .check(...MONEY),
  capacity: z.int().min(1).max(50),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
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
 * `ownerId` is omitted rather than optional: the owner is the signed-in user, taken from
 * the session on the server. Accepting it from the client would make the field a way to
 * create a listing in somebody else's name — the same reason the price of a stay is
 * computed by the server in phase 6 instead of being sent along with the booking.
 */
export const createListingSchema = listingSchema.omit({
  id: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * A PATCH body: any subset of the editable fields, but not an empty one — an update that
 * changes nothing is a mistake on the caller's side rather than a no-op worth storing.
 */
export const updateListingSchema = createListingSchema
  .partial()
  .refine((listing) => Object.keys(listing).length > 0, {
    message: "At least one field must be provided",
  });

export const listingListSchema = z.array(listingSchema);

/**
 * A filter nobody filled in, as a URL spells it. An empty input serialises to `?guests=`
 * rather than to nothing at all, and every coercion below would read that differently:
 * `Number("")` is `0`, so `minPrice` would quietly become a filter while `maxPrice`,
 * `guests`, `limit` and `cursor` each answered `400`. The blank is turned into the absence
 * it means before any of them sees it, so one form with three empty fields asks the same
 * question as a form with none.
 */
const blank = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

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
 * `cursor` is opaque on purpose — it is issued by `nextCursor` of the previous page and
 * decoded only by the API, so how the pages are cut stays the server's to change. It names
 * a place in one ordering, which is why it travels with the `sort` it was issued under and
 * why the API refuses it against another: a page is only the next one of the same list.
 * `limit` has a ceiling because it is the one parameter a client could use to ask for the
 * whole table.
 */
export const listingQuerySchema = z
  .object({
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
    guests: blank(z.coerce.number().int().min(1).max(50).optional()),
    sort: blank(listingSortSchema.default("newest")),
    cursor: blank(z.string().min(1).optional()),
    limit: blank(z.coerce.number().int().min(1).max(50).default(20)),
  })
  .refine((query) => (query.from === undefined) === (query.to === undefined), {
    message: "Filtering by dates needs both a check-in and a check-out date",
    path: ["to"],
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      query.from < query.to,
    {
      message: "Check-out date must be later than check-in date",
      path: ["to"],
    },
  )
  .refine(
    (query) =>
      query.minPrice === undefined ||
      query.maxPrice === undefined ||
      query.minPrice <= query.maxPrice,
    {
      message: "The lowest price must not be above the highest",
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

const MS_PER_NIGHT = 24 * 60 * 60 * 1000;

/** Whole nights between two `YYYY-MM-DD` dates; both are read as UTC midnight, so it is exact. */
const nights = (from: string, to: string): number =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      MS_PER_NIGHT,
  );

export const availabilityQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine((window) => window.from < window.to, {
    message: "The end of the window must be later than its start",
    path: ["to"],
  })
  .refine(
    (window) =>
      window.from >= window.to ||
      nights(window.from, window.to) <= MAX_WINDOW_NIGHTS,
    {
      message: `The window may not be wider than ${String(MAX_WINDOW_NIGHTS)} nights`,
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
export type ListingSort = z.infer<typeof listingSortSchema>;
export type ListingSummary = z.infer<typeof listingSummarySchema>;
export type ListingQuery = z.infer<typeof listingQuerySchema>;
export type ListingPage = z.infer<typeof listingPageSchema>;
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
export type BookedRange = z.infer<typeof bookedRangeSchema>;
export type ListingAvailability = z.infer<typeof listingAvailabilitySchema>;
export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
