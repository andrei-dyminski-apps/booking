import { z } from "zod";
import { dayMessage, isDay, today } from "./day.js";
import { listingSummarySchema } from "./listing.js";
import { blank, PAGING } from "./query.js";

/**
 * The lifecycle of a stay, mirrored by the `BookingStatus` enum of the Prisma schema.
 * `PENDING_PAYMENT` is a hold — the slot is taken while the guest pays, and `expiresAt`
 * is when the hold lapses. `CONFIRMED` is a paid stay (phase 6). `CANCELLED` and
 * `EXPIRED` are terminal and free the slot: only the first two are "active", which is the
 * set the overlap rule and the database `EXCLUDE` constraint act on.
 */
export const bookingStatusSchema = z.enum([
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
]);

/** The four names as a runtime value, the way `Role` is derived from `roleSchema`. */
export const BookingStatus = bookingStatusSchema.enum;

/**
 * Dates are stored as `YYYY-MM-DD`, so they compare lexicographically.
 *
 * A booking names two people-facing rows rather than free text: the listing it takes and
 * the guest who took it. That is what phase 3 checks against — the guest may cancel their
 * own booking, the owner of the listing may read the bookings against it — and no rule of
 * that kind can be written against a `roomId` string and a typed-in guest name.
 */
export const bookingSchema = z.object({
  id: z.uuid(),
  listingId: z.uuid(),
  /**
   * Where the stay is, resolved whether or not the listing is still offered. That is the
   * whole reason it is here: retiring a listing keeps the row so a booking can go on
   * naming it, but `GET /listings/:id` answers `404` for a retired one — to its guest as
   * much as to a stranger — and that read is public and cached by URL, so it is not the
   * place to make an exception for whoever holds a stay. See `listingSummarySchema`.
   */
  listing: listingSummarySchema,
  guestId: z.uuid(),
  from: z.iso.date({
    error: dayMessage(
      "A check-in date is required",
      "A check-in date must be written as YYYY-MM-DD",
    ),
  }),
  to: z.iso.date({
    error: dayMessage(
      "A check-out date is required",
      "A check-out date must be written as YYYY-MM-DD",
    ),
  }),
  status: bookingStatusSchema,
  /**
   * When the hold lapses — and it stays on the row after it has. Which moment a stay
   * stopped holding its slot is what a refund or a dispute asks about, and `status`
   * already says whether it still holds one, so clearing the column would only leave
   * `createdAt` as the single time on the record. `null` is a booking that never was a
   * hold.
   */
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

/**
 * `guestId` comes from the session, so a request cannot book in another person's name.
 * `status` and `expiresAt` are the server's to set — a booking is always created as a
 * hold, and the deadline is computed from the server clock. `listing` is omitted for the
 * same reason: `listingId` is what a request names, and what that id resolves to is the
 * server's answer rather than the client's claim.
 */
export const createBookingSchema = bookingSchema
  .omit({
    id: true,
    listing: true,
    guestId: true,
    status: true,
    expiresAt: true,
    createdAt: true,
  })
  // Both rules are about a date and wait for one: without the guard an empty check-in box
  // reads as a stay in the past — `"" >= today()` is false — and the form puts that under a
  // box nobody has filled in yet, beside the refusal that is actually true.
  // `listingQuerySchema` guards its own cross-field rules the same way.
  .refine(
    (booking) =>
      !isDay(booking.from) || !isDay(booking.to) || booking.from < booking.to,
    {
      message: "Check-out date must be later than check-in date",
      path: ["to"],
    },
  )
  .refine((booking) => !isDay(booking.from) || booking.from >= today(), {
    message: "Check-in date cannot be in the past",
    path: ["from"],
  });

export const bookingListSchema = z.array(bookingSchema);

/**
 * How a list of stays is ordered, as the client asks for it. Four values rather than a
 * field and a direction, for the reason `listingSortSchema` gives: the tiebreaker of a
 * keyset page has to follow the direction of the key it breaks ties in, so what a client
 * picks is the whole ordering and the index behind each one is the server's business.
 *
 * The two keys are the two moments a stay has: when it was taken (`createdAt`) and when
 * it starts (`from`). `newest` is the default because a list nobody has asked anything of
 * shows what has just happened; the check-in pair is what a person planning around the
 * stays compares them on.
 */
export const bookingSortSchema = z.enum([
  "newest",
  "oldest",
  "checkInAsc",
  "checkInDesc",
]);

/**
 * The query of `GET /bookings`, as it arrives in the URL — `searchParams` on the frontend
 * and a query string here, so every value is text until it is coerced.
 *
 * **None of it is a scope.** What a caller may see is decided by their role inside the
 * `where` of the query — a guest sees the stays they took, an owner the stays taken
 * against their listings, an admin all of them — and every filter below narrows that
 * further rather than widening it. `guestId` is therefore not a way to read another
 * person's stays: for a guest it can only ever name themselves, and naming anybody else
 * answers with the empty list it truthfully is.
 *
 * `from`/`to` are a window a stay has to overlap, not a pair of bounds on the check-in:
 * "the stays that touch these dates" is the question a person asks of a list of bookings,
 * and it is the same half-open comparison the overlap check inside `POST /bookings` makes.
 * They are all-or-nothing like the catalogue's, and for the same reason — one date alone
 * is half a question, and answering it by guessing the other end returns a different list
 * than the one that was asked for.
 */
export const bookingQuerySchema = z
  .object({
    status: blank(bookingStatusSchema.optional()),
    listingId: blank(z.uuid().optional()),
    guestId: blank(z.uuid().optional()),
    from: blank(z.iso.date().optional()),
    to: blank(z.iso.date().optional()),
    sort: blank(bookingSortSchema.default("newest")),
    ...PAGING,
  })
  .refine((query) => (query.from === undefined) === (query.to === undefined), {
    message: "Filtering by dates needs both a start and an end",
    path: ["to"],
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      query.from < query.to,
    {
      message: "The end of the window must be later than its start",
      path: ["to"],
    },
  );

/**
 * One page of stays. `nextCursor` is `null` on the last page — the client asks for the
 * next one by handing it back, and never by counting rows: an offset shifts under a
 * booking taken while somebody is paging, and a keyset cursor does not.
 *
 * The list is paged at all because one of the three scopes has no ceiling on it: an
 * admin's `GET /bookings` is every stay on the site, and a guest's own history is the only
 * one of the three that stays small by itself.
 */
export const bookingPageSchema = z.object({
  items: bookingListSchema,
  nextCursor: z.string().nullable(),
});

export type BookingStatus = z.infer<typeof bookingStatusSchema>;
export type BookingSort = z.infer<typeof bookingSortSchema>;
export type BookingQuery = z.infer<typeof bookingQuerySchema>;
export type BookingPage = z.infer<typeof bookingPageSchema>;
export type Booking = z.infer<typeof bookingSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
