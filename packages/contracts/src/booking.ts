import { z } from "zod";
import { cancellationPolicySchema } from "./cancellation-policy.js";
import {
  CHECK_IN_DAY_PAST,
  checkInTimeSchema,
  isCheckInDayPast,
  storedTimeZoneSchema,
  type CheckIn,
} from "./check-in.js";
import { dayMessage, earliestToday, isDay } from "./day.js";
import { listingSummarySchema } from "./listing.js";
import { centsSchema, currencySchema } from "./money.js";
import { bookingRateSchema, pricedNightSchema } from "./pricing.js";
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
 * A dispute of a stay's payment with the guest's bank, mirrored by the `DisputeStatus` enum
 * of the Prisma schema. `LOST` is the platform's loss: the bank gave the guest their money.
 */
export const disputeStatusSchema = z.enum(["OPEN", "WON", "LOST"]);

export const DisputeStatus = disputeStatusSchema.enum;

/**
 * Who cancelled a stay, mirrored by the `Canceller` enum of the Prisma schema: its guest, the
 * host of its listing, or an admin. It decides the refund (`refundQuote`) and, for the host,
 * the fee the cancellation costs them (`hostCancellationFee`).
 */
export const cancellerSchema = z.enum(["GUEST", "HOST", "ADMIN"]);

export const Canceller = cancellerSchema.enum;

/** The longest reason a cancellation may carry — a sentence or two, not a letter. */
export const MAX_CANCELLATION_REASON_LENGTH = 500;

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
  /**
   * Who owns the listing the stay takes — its host. Not a secret from the guest, who writes
   * to the host about the stay anyway; it is what tells a screen whether its viewer is the
   * host, who may cancel the stay too, at a fee.
   */
  hostId: z.uuid(),
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
   * What the stay costs, quoted by the server when the hold is taken (`nightlyPrice` over its
   * nights), and what the payment charges. A copy: a later price change does not restate it.
   * In whole cents of `currency`, like every amount on this contract.
   */
  amountCents: centsSchema,
  /**
   * What every amount of this stay is cents of — the currency it was charged in, stored with
   * it rather than assumed, so the record says on its own what the money was.
   */
  currency: currencySchema,
  /**
   * The listing's cancellation policy when the hold was taken — a copy, like `amountCents`:
   * a later change of the listing's policy does not restate the stay. `refundQuote`
   * (`refund.ts`) reads it.
   */
  cancellationPolicy: cancellationPolicySchema,
  /**
   * The listing's time zone and check-in time when the hold was taken — copies, like the
   * policy. Together with `from` they are the moment the stay begins (`checkInInstant`),
   * which every refund window, the host's fee and the payout are measured from.
   */
  timeZone: storedTimeZoneSchema,
  checkInTime: checkInTimeSchema,
  /**
   * What went back to the guest, or `null` when nothing did: a cancellation after every
   * refund window closed, a hold that was never paid. See `refundQuote` (`refund.ts`).
   */
  refundedAmountCents: centsSchema.nullable(),
  /**
   * What a cancellation is giving back and has not sent yet, or `null`. The refund follows
   * the cancellation in the background and moves into `refundedAmountCents` once sent.
   */
  refundOwedCents: centsSchema.nullable(),
  /** A payment confirmed this booking at some point, whatever its status is now. */
  paid: z.boolean(),
  /**
   * Where a dispute of the payment stands with the guest's bank, or `null`. Open, a
   * cancellation waits for the outcome; lost, the bank gave the money back already.
   */
  dispute: disputeStatusSchema.nullable(),
  /**
   * When the hold lapses — and it stays on the row after it has. Which moment a stay
   * stopped holding its slot is what a refund or a dispute asks about, and `status`
   * already says whether it still holds one, so clearing the column would only leave
   * `createdAt` as the single time on the record. `null` is a booking that never was a
   * hold.
   */
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /** Who cancelled the stay, or `null` for one nobody cancelled. */
  cancelledBy: cancellerSchema.nullable(),
  /** When it was cancelled, or `null`. */
  cancelledAt: z.iso.datetime().nullable(),
  /**
   * Why, as whoever cancelled it put it — always given by a host, optional for the guest
   * and an admin. Both sides of the stay read it.
   */
  cancellationReason: z.string().nullable(),
  /**
   * When the stay was ended early, or `null`. `to` is the check-out it moved to then — the
   * nights after it went back on offer — and `nights` on `bookingDetailSchema` keeps what was
   * bought, so the two together say what was given up. See `unusedNightsRefund`.
   */
  endedEarlyAt: z.iso.datetime().nullable(),
  /**
   * Which halves of the stay have been reviewed — the guest's word on the listing and the
   * host's word on the guest. Flags rather than the reviews themselves: the reader of a
   * booking is either of the two, and the half written about them is read where it is
   * public (the listing) or where it is scoped (`GET /guests/:id/reviews`), not here.
   * What the screen needs from the booking is whether to offer the form.
   */
  reviewed: z.object({ byGuest: z.boolean(), byOwner: z.boolean() }),
});

/**
 * `guestId` comes from the session, so a request cannot book in another person's name.
 * The money fields are the server's to work out — a price taken from the client would be a
 * price the client chooses. `status` and `expiresAt` are the server's to set — a booking is
 * always created as a hold, and the deadline is computed from the server clock. `listing` is omitted for the
 * same reason: `listingId` is what a request names, and what that id resolves to is the
 * server's answer rather than the client's claim.
 */
const stayRequestFields = bookingSchema.omit({
  id: true,
  listing: true,
  guestId: true,
  hostId: true,
  status: true,
  amountCents: true,
  currency: true,
  cancellationPolicy: true,
  timeZone: true,
  checkInTime: true,
  refundedAmountCents: true,
  refundOwedCents: true,
  paid: true,
  dispute: true,
  expiresAt: true,
  createdAt: true,
  cancelledBy: true,
  cancelledAt: true,
  cancellationReason: true,
  endedEarlyAt: true,
  reviewed: true,
});

/**
 * Both rules are about a date and wait for one: without the guard an empty check-in box
 * reads as a stay in the past — `"" >= earliestToday()` is false — and the form puts that under a
 * box nobody has filled in yet, beside the refusal that is actually true.
 * `listingQuerySchema` guards its own cross-field rules the same way.
 */
function withStayRules<T extends z.ZodType<{ from: string; to: string }>>(
  schema: T,
): T {
  return (
    schema
      .refine(
        (booking) =>
          !isDay(booking.from) ||
          !isDay(booking.to) ||
          booking.from < booking.to,
        {
          error: "Check-out date must be later than check-in date",
          path: ["to"],
        },
      )
      // Only what is gone everywhere: the listing's own today is read under the lock that
      // takes the hold (`isCheckInDayPast`), since this schema does not know where it is.
      .refine(
        (booking) => !isDay(booking.from) || booking.from >= earliestToday(),
        { error: CHECK_IN_DAY_PAST, path: ["from"] },
      )
  );
}

/**
 * A listing and a range of nights under the booking's rules, and nothing else — what the
 * waitlist asks for, so a range the booking form would refuse is refused there in the same
 * words.
 */
export const stayRequestSchema = withStayRules(stayRequestFields);

export const createBookingSchema = withStayRules(
  stayRequestFields.extend({
    /**
     * The listing's `updatedAt` as the page that offered the stay read it — one version of
     * every term the guest was shown beside the button: the prices the quote was worked
     * out from and the cancellation policy the hold copies. Every save of the listing
     * stamps it, so when the listing's is no longer this one the hold is refused rather
     * than taken at a price, or frozen under a policy, the guest never saw. Optional, so a
     * client that shows no terms can still book.
     */
    listingUpdatedAt: z.iso.datetime().optional(),
    /**
     * The rate the stay is booked at — `STANDARD` when left out. `NON_REFUNDABLE` takes the
     * listing's discount off the total and freezes the `NON_REFUNDABLE` policy onto the
     * stay; a listing that offers no such rate refuses it.
     */
    rate: bookingRateSchema.optional(),
  }),
);

/**
 * `createBookingSchema` with the listing's own today beside the earliest one — what the
 * booking form, which knows where the listing is, checks before a request is spent. The API
 * checks the same day under the lock that takes the hold (`isCheckInDayPast`), so this is a
 * convenience of the form and never the check. A day gone everywhere is left to the rule
 * above, so the box is not told the same thing twice.
 */
export function createBookingSchemaIn(listing: Pick<CheckIn, "timeZone">) {
  return createBookingSchema.refine(
    (booking) =>
      !isDay(booking.from) ||
      booking.from < earliestToday() ||
      !isCheckInDayPast(listing, booking.from, new Date()),
    { error: CHECK_IN_DAY_PAST, path: ["from"] },
  );
}

const cancellationReason = z
  .string()
  .trim()
  .max(MAX_CANCELLATION_REASON_LENGTH, {
    error: `A reason can be at most ${String(MAX_CANCELLATION_REASON_LENGTH)} characters long`,
  });

/** What a host who cancels without a reason is told — by the API and by the form alike. */
export const HOST_REASON_REQUIRED =
  "Say why you are cancelling — the guest is told";

/**
 * The body of `DELETE /bookings/:id`. A host has to say why they take a stay away from its
 * guest — the guest is told, and an admin reads it — which is a rule about who is asking,
 * so the API enforces it (`hostCancelBookingSchema` is the same rule for the host's form); a
 * guest and an admin may say nothing. Blank is nothing.
 */
export const cancelBookingSchema = z.object({
  reason: cancellationReason
    .transform((reason) => (reason === "" ? undefined : reason))
    .optional(),
});

/** The host's cancellation: the same body, the reason required. */
export const hostCancelBookingSchema = z.object({
  reason: cancellationReason.min(1, { error: HOST_REASON_REQUIRED }),
});

export const bookingListSchema = z.array(bookingSchema);

/**
 * One stay as its own page reads it: the booking, and what each of its nights cost when the
 * hold was quoted — `amountCents` is their sum less `discountCents`. Only
 * `GET /bookings/:id` answers with it, for the reason a listing's exceptions travel with one
 * listing: a page of stays would carry a list per row that nobody reading the page looks
 * at. The nights are empty for a stay taken before they were recorded.
 */
export const bookingDetailSchema = bookingSchema.extend({
  nights: z.array(pricedNightSchema),
  /**
   * What the stay's rate took off the nights — `amountCents` is their sum less this. Zero
   * for a stay at the standard rate.
   */
  discountCents: centsSchema,
});

/**
 * What the payment form needs for one hold: its PaymentIntent's `client_secret`, which
 * Stripe Elements confirms, and the amount and currency. Answered to the guest alone.
 */
export const bookingPaymentSchema = z.object({
  clientSecret: z.string(),
  /** In cents, as Stripe counts it. */
  amountCents: centsSchema,
  currency: currencySchema,
});

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
 * Which side of a stay an account is on: the guest who took it or the host of the listing
 * it takes. One account can be both — on different stays, never on one — so a notice says
 * which side its recipient is, and a list of stays is asked for one side at a time.
 */
export const stayPartySchema = z.enum(["GUEST", "HOST"]);

export const StayParty = stayPartySchema.enum;

/**
 * The query of `GET /bookings`, as it arrives in the URL — `searchParams` on the frontend
 * and a query string here, so every value is text until it is coerced.
 *
 * **None of the filters is a scope.** What a caller may see is decided inside the
 * `where` of the query — an account sees the stays it took or the stays taken against its
 * listings, an admin all of them — and every filter below narrows that further rather
 * than widening it. `guestId` is therefore not a way to read another person's stays: on
 * the guest's side it can only ever name the caller, and naming anybody else answers with
 * the empty list it truthfully is.
 *
 * `side` picks which of the two scopes of an account is asked for — the stays it took or
 * the ones against its listings. It cannot reach past them, and an admin's scope has no
 * sides, so theirs ignores it.
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
    side: blank(stayPartySchema.default("GUEST")),
    from: blank(z.iso.date().optional()),
    to: blank(z.iso.date().optional()),
    sort: blank(bookingSortSchema.default("newest")),
    ...PAGING,
  })
  .refine((query) => (query.from === undefined) === (query.to === undefined), {
    error: "Filtering by dates needs both a start and an end",
    path: ["to"],
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      query.from < query.to,
    {
      error: "The end of the window must be later than its start",
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

export type StayParty = z.infer<typeof stayPartySchema>;
export type BookingStatus = z.infer<typeof bookingStatusSchema>;
export type DisputeStatus = z.infer<typeof disputeStatusSchema>;
export type Canceller = z.infer<typeof cancellerSchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
export type BookingSort = z.infer<typeof bookingSortSchema>;
export type BookingQuery = z.infer<typeof bookingQuerySchema>;
export type BookingPage = z.infer<typeof bookingPageSchema>;
export type Booking = z.infer<typeof bookingSchema>;
export type BookingDetail = z.infer<typeof bookingDetailSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type BookingPayment = z.infer<typeof bookingPaymentSchema>;
