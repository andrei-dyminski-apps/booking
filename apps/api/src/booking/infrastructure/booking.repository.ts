import { Injectable } from "@nestjs/common";
import {
  BookingRate,
  BookingStatus,
  CancellationPolicy,
  isCheckInDayPast,
  quoteStay,
  type BookedRange,
  type Booking,
  type BookingQuery,
  type BookingSort,
  type CreateBookingInput,
} from "@repo/contracts";
import { z } from "zod";
import { isEqual, parseISO } from "date-fns";
import type { Prisma } from "../../generated/prisma/client";
import {
  isExclusionViolation,
  isPrismaError,
  PrismaErrorCode,
  violatedConstraint,
} from "../../prisma/prisma.errors";
import {
  afterCreatedAt,
  CREATED_AT_ORDER,
  type Page,
} from "../../common/paging";
import { readPricedListing } from "../../listing/listing-pricing";
import { toIsoDate } from "../../common/iso-date";
import { PrismaService } from "../../prisma/prisma.service";
import { holdExpiry } from "../domain/booking-status";
import {
  CheckInDayPastError,
  DatesUnavailableError,
  GuestNotFoundError,
  ListingChangedError,
  ListingNotFoundError,
  OwnListingError,
  RateNotOfferedError,
} from "../domain/booking.errors";
import type {
  BookingCursor,
  BookingDetailWithListingOwner,
  BookingWithListingOwner,
  ConfirmedStay,
  CreatedBooking,
  ReleasedHold,
} from "../domain/booking.types";
import { cents, type Cents } from "../../payment/domain/money";
import {
  BOOKING_INCLUDE,
  checkInData,
  RELEASED_HOLD_INCLUDE,
  stayMoneyData,
  toBooking,
  toReleasedHold,
  type BookingRowWithListing,
} from "./stay-rows";
import {
  againstListingsOf,
  bookingExists,
  holdsTheSlot,
  lapsedHolds,
  overlapping,
} from "./booking-where";

/** One row of the `FOR UPDATE` read — raw SQL, so the column keeps its stored name. */
type LockedListing = {
  id: string;
  owner_id: string;
  deleted_at: Date | null;
  cancellation_policy: CancellationPolicy;
  non_refundable_discount_bps: number | null;
  time_zone: string;
  check_in_time: string;
  updated_at: Date;
};

function withListingOwner(row: BookingRowWithListing): BookingWithListingOwner {
  return {
    booking: toBooking(row),
    listingOwnerId: row.listing.ownerId,
    paymentId: row.paymentIntentId,
  };
}

/**
 * The reads of a stay, the hold and its payment, and the module's knowledge about how a stay
 * is stored: that dates live in `@db.Date` columns while the contract speaks `YYYY-MM-DD`,
 * that a stay has a status and only two of the four hold the slot, and that an overlap is a
 * pair of strict inequalities. The cancellation is `BookingCancellationRepository`'s, the
 * money that goes back to a guest `BookingRefundRepository`'s; the `where` clauses the three
 * share with each other and with the other modules are in `booking-where.ts`.
 *
 * `create` is phase 4's centrepiece: an interactive transaction that locks the listing
 * row, so competing bookings for one listing are serialised instead of racing the
 * read-then-insert this module used to do.
 */
@Injectable()
export class BookingRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /** Every stay there is — the admin's scope, and the one with no ceiling on it. */
  findPageForEveryone(
    query: BookingQuery,
    cursor: BookingCursor | null,
  ): Promise<Page<Booking>> {
    return this.findPage({}, query, cursor);
  }

  /** The stays this guest took. */
  findPageForGuest(
    guestId: string,
    query: BookingQuery,
    cursor: BookingCursor | null,
  ): Promise<Page<Booking>> {
    return this.findPage({ guestId }, query, cursor);
  }

  /**
   * The stays taken against this owner's listings — a relation rather than a column, which
   * is why it is the one scope the indexes below cannot serve as a seek. See the note on
   * `ORDER_BY`.
   */
  findPageForListingOwner(
    ownerId: string,
    query: BookingQuery,
    cursor: BookingCursor | null,
  ): Promise<Page<Booking>> {
    return this.findPage(againstListingsOf(ownerId), query, cursor);
  }

  /**
   * Resolves the listing whether or not it has been retired, and the booking whatever its
   * status — the stay is what both rows were kept for. A cancelled or expired booking is
   * a record its guest is entitled to read, not a row that vanishes: `status` is on the
   * contract precisely so the answer can say which of the four it is, and the rules that
   * do care about "active" — the overlap check and what may still be cancelled — narrow
   * for themselves.
   */
  async findByIdWithListingOwner(
    id: string,
  ): Promise<BookingWithListingOwner | null> {
    const row = await this.prismaService.booking.findFirst({
      where: { id },
      include: BOOKING_INCLUDE,
    });

    return row === null ? null : withListingOwner(row);
  }

  /**
   * `findByIdWithListingOwner` with what each night cost when the hold was quoted, in the
   * order of the stay, and the discount taken off them, read in the same statement. The
   * nights are empty for a stay taken before they were recorded.
   */
  async findDetailWithListingOwner(
    id: string,
  ): Promise<BookingDetailWithListingOwner | null> {
    const row = await this.prismaService.booking.findFirst({
      where: { id },
      include: { ...BOOKING_INCLUDE, nights: { orderBy: { date: "asc" } } },
    });

    return row === null
      ? null
      : {
          ...withListingOwner(row),
          nights: row.nights.map((night) => ({
            date: toIsoDate(night.date),
            priceCents: cents(night.priceCents),
          })),
          discountCents: cents(row.discountCents),
        };
  }

  async exists(id: string): Promise<boolean> {
    return bookingExists(this.prismaService, id);
  }

  /**
   * Whether this guest has a live hold or a confirmed stay against one of this owner's
   * listings. It is what lets a host read what other hosts said about a guest: one who is
   * asking to stay with them — a hold is asking — or has stayed is somebody they have a
   * reason to look up, and everybody else is not. A cancelled, expired or lapsed request
   * is not: asking once is not a standing licence to read a guest's record. That is
   * `holdsTheSlot`, which reads no dates, so a confirmed stay keeps counting after it is
   * over — the host is the one who may review it. The listings are `againstListingsOf`,
   * the scope of the owner's page of stays.
   */
  async hasStayedWith(guestId: string, ownerId: string): Promise<boolean> {
    const row = await this.prismaService.booking.findFirst({
      where: {
        guestId,
        ...againstListingsOf(ownerId),
        ...holdsTheSlot(new Date()),
      },
      select: { id: true },
    });

    return row !== null;
  }

  /**
   * When a listing is taken, for the window a calendar is drawing — the read behind
   * `GET /listings/:id/availability`, and the same question the catalogue's date filter
   * asks of every listing at once. Only the stays that still hold the slot count, and a
   * range is returned whole rather than clipped to the window: a stay that runs past the
   * last day of it is not free on that day.
   *
   * It answers about a listing but reads bookings, which is why it lives here and is
   * injected into `ListingService` rather than being written a second time over there:
   * a `where` may cross between the two repositories, a row mapping may not — dates are
   * `@db.Date` columns and this file is the one that knows it.
   */
  async findActiveRanges(
    listingId: string,
    window: { from: string; to: string },
  ): Promise<BookedRange[]> {
    const rows = await this.prismaService.booking.findMany({
      where: {
        listingId,
        ...holdsTheSlot(new Date()),
        ...overlapping(window.from, window.to),
      },
      select: { from: true, to: true },
      orderBy: { from: "asc" },
    });

    return rows.map((row) => ({
      from: toIsoDate(row.from),
      to: toIsoDate(row.to),
    }));
  }

  /**
   * The three layers of phase 4, in one transaction:
   *
   *  1. `SELECT ... FOR UPDATE` on the listing row — two creates for the same listing
   *     serialise here instead of racing. `deleted_at` is read under the lock, the check
   *     the database stopped making when listings became soft-deletable, and `owner_id`
   *     beside it, which refuses a guest booking their own listing.
   *  2. flip this listing's lapsed holds to `EXPIRED`, so a stale `PENDING_PAYMENT` row
   *     neither blocks the slot nor trips the `EXCLUDE` constraint on the insert below.
   *  3. refuse an overlap with an active stay — the informative `409`.
   *  4. quote the stay off the listing's prices (`quoteStay`), read under the same lock,
   *     at the rate asked for, beside the cancellation policy the stay copies — refused
   *     when the listing does not offer the rate, and before anything else when it was
   *     saved since the version the request names (`listingUpdatedAt`).
   *  5. insert the hold with that amount. The `EXCLUDE` constraint is the last line of
   *     defence if a bug ever reaches here, and it is answered as the same `409`.
   *
   * The owner comes back beside the booking because the locked read has it anyway, and the
   * service tells that owner about the hold — without a second query after the commit.
   */
  async create(
    guestId: string,
    input: CreateBookingInput,
  ): Promise<CreatedBooking> {
    // One reading of the clock for the whole transaction: the sweep below, the overlap
    // check and the deadline of the hold are three halves of one decision, and a second
    // `new Date()` between them would let a hold expire in the middle of it.
    const now = new Date();

    return this.prismaService.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<LockedListing[]>`
        SELECT id, owner_id, deleted_at, cancellation_policy,
               non_refundable_discount_bps, time_zone, check_in_time, updated_at
        FROM listings WHERE id = ${input.listingId}::uuid FOR UPDATE
      `;

      const listing = locked[0];

      if (listing === undefined || listing.deleted_at !== null) {
        throw new ListingNotFoundError(input.listingId);
      }

      if (listing.owner_id === guestId) {
        throw new OwnListingError(input.listingId);
      }

      // The version of the terms the guest was shown, against the row this hold is about
      // to be priced off and copy its policy from — both read under the lock a host's
      // save of the listing, prices included, has to wait for.
      if (
        input.listingUpdatedAt !== undefined &&
        !isEqual(parseISO(input.listingUpdatedAt), listing.updated_at)
      ) {
        throw new ListingChangedError(input.listingId);
      }

      // The listing's today, off its zone under the lock a host moving the listing to
      // another zone waits for: a night already over there is not for sale, and tonight
      // there is, whatever day UTC has reached. After the version: a form read before the
      // listing moved east is told to read it again (`412`), not that its day has passed.
      if (isCheckInDayPast({ timeZone: listing.time_zone }, input.from, now)) {
        throw new CheckInDayPastError(input.listingId, input.from);
      }

      const released = await tx.booking.updateManyAndReturn({
        where: { listingId: input.listingId, ...lapsedHolds(now) },
        data: { status: BookingStatus.EXPIRED },
        include: RELEASED_HOLD_INCLUDE,
      });

      const overlap = await tx.booking.findFirst({
        where: {
          listingId: input.listingId,
          ...holdsTheSlot(now),
          ...overlapping(input.from, input.to),
        },
        select: { id: true },
      });

      if (overlap !== null) {
        throw new DatesUnavailableError(input);
      }

      // The rate asked for, off the same locked row: the discount it takes and the policy it
      // freezes — a non-refundable stay is `NON_REFUNDABLE` whatever the listing's own. After
      // the overlap, so taken nights are the `409` a stale calendar reads whatever rate the
      // request named.
      const nonRefundable = input.rate === BookingRate.NON_REFUNDABLE;

      if (nonRefundable && listing.non_refundable_discount_bps === null) {
        throw new RateNotOfferedError(input.listingId);
      }

      const discountBps = nonRefundable
        ? listing.non_refundable_discount_bps
        : null;
      const cancellationPolicy = nonRefundable
        ? CancellationPolicy.NON_REFUNDABLE
        : listing.cancellation_policy;

      // The quote is taken under the same lock as the nights, so a save of the listing's
      // prices — which writes this row first — either lands before it or waits for it.
      const priced = await readPricedListing(tx, input.listingId, input);

      if (priced === null) {
        throw new ListingNotFoundError(input.listingId);
      }

      const money = stayMoneyData(
        quoteStay(priced, input.from, input.to, discountBps),
      );

      try {
        const row = await tx.booking.create({
          data: {
            listingId: input.listingId,
            guestId,
            from: new Date(input.from),
            to: new Date(input.to),
            status: BookingStatus.PENDING_PAYMENT,
            expiresAt: holdExpiry(now),
            // The breakdown behind the amount, from the same quote and in the same insert.
            ...money,
            // Copied as the amount is, so a later change of the listing's policy does not
            // restate this stay's refunds.
            cancellationPolicy,
            // The moment the stay begins, copied for the same reason: a later move of the
            // listing's check-in does not move this stay's windows or its payout.
            ...checkInData({
              from: input.from,
              timeZone: listing.time_zone,
              checkInTime: listing.check_in_time,
            }),
          },
          include: BOOKING_INCLUDE,
        });

        return {
          booking: toBooking(row),
          listingOwnerId: listing.owner_id,
          paymentId: null,
          released: released.map(toReleasedHold),
        };
      } catch (error) {
        if (isExclusionViolation(error)) {
          throw new DatesUnavailableError(input);
        }

        if (isPrismaError(error, PrismaErrorCode.ForeignKeyViolation)) {
          // The listing key is unreachable from here — the `FOR UPDATE` read already
          // refused a missing row. What is left is the guest, which nothing checks first.
          switch (violatedForeignKey(error)) {
            case LISTING_FOREIGN_KEY:
              throw new ListingNotFoundError(input.listingId);
            case GUEST_FOREIGN_KEY:
              throw new GuestNotFoundError(guestId);
          }
        }

        throw error;
      }
    });
  }

  /** Only into an empty column, and only while pending: `false` is a hold released meanwhile. */
  async attachPayment(id: string, paymentId: string): Promise<boolean> {
    const { count } = await this.prismaService.booking.updateMany({
      where: {
        id,
        status: BookingStatus.PENDING_PAYMENT,
        OR: [{ paymentIntentId: null }, { paymentIntentId: paymentId }],
      },
      data: { paymentIntentId: paymentId },
    });

    return count > 0;
  }

  /**
   * Any `PENDING_PAYMENT` row, whatever its deadline: a lapsed hold no path has released
   * still holds its nights. Read back from the `UPDATE`, so of two runs only one is told.
   */
  async confirmPayment(
    id: string,
    paymentId: string,
    chargeId: string | null,
    amount: Cents,
  ): Promise<ConfirmedStay | null> {
    const [confirmed] = await this.prismaService.booking.updateManyAndReturn({
      where: {
        id,
        status: BookingStatus.PENDING_PAYMENT,
        // Another sum than quoted confirms nothing and goes back; a safeguard only.
        amountCents: amount,
        // The intent the payment form opened, or none yet when its write was lost — never
        // another one naming the same booking, which `attachPayment` would refuse too.
        OR: [{ paymentIntentId: null }, { paymentIntentId: paymentId }],
      },
      data: {
        status: BookingStatus.CONFIRMED,
        paymentIntentId: paymentId,
        chargeId,
        paidAt: new Date(),
      },
      include: RELEASED_HOLD_INCLUDE,
    });

    return confirmed === undefined ? null : toReleasedHold(confirmed);
  }

  async markConfirmationAnnounced(id: string): Promise<void> {
    await this.prismaService.booking.updateMany({
      where: { id, confirmationAnnouncedAt: null },
      data: { confirmationAnnouncedAt: new Date() },
    });
  }

  /**
   * What the job scheduled for one hold's deadline does. Idempotent and safe to run late —
   * a hold already confirmed, cancelled or expired matches the `where` on nothing, and the
   * job is a no-op. The answer is the hold it released, at most one: the `UPDATE` reads the
   * row back itself, so of two runs racing over one hold only the one that flipped it hears
   * about it, and the notice cannot go out twice.
   */
  async expireHold(id: string): Promise<ReleasedHold[]> {
    const released = await this.prismaService.booking.updateManyAndReturn({
      where: { id, ...lapsedHolds(new Date()) },
      data: { status: BookingStatus.EXPIRED },
      include: RELEASED_HOLD_INCLUDE,
    });

    return released.map(toReleasedHold);
  }

  /**
   * The same thing asked of every listing at once, and what the repeatable sweep runs.
   * It exists because the per-hold jobs live in Redis and the lazy check inside `create`
   * only ever looks at the listing being booked: without it, a hold whose job was lost on
   * a listing nobody books again would hold its slot forever. The holds it released are
   * what the processor logs and what their two sides are told about.
   */
  async expireLapsedHolds(): Promise<ReleasedHold[]> {
    const released = await this.prismaService.booking.updateManyAndReturn({
      where: lapsedHolds(new Date()),
      data: { status: BookingStatus.EXPIRED },
      include: RELEASED_HOLD_INCLUDE,
    });

    return released.map(toReleasedHold);
  }

  /**
   * One page of stays: the caller's scope, the filters and the keyset cursor as three
   * conditions of one `where`, and `limit + 1` rows so the caller learns whether there is
   * a page after this one without a second `count`.
   *
   * **The three are `AND`-ed rather than spread into one object, and that is a rule about
   * the scope rather than a matter of shape.** `guestId` is both a scope and a filter —
   * spread, the filter would replace the scope, and a guest asking for `?guestId=` of
   * somebody else would be handed their stays. An `AND` cannot lose a condition that way:
   * every one of the three has to hold. The cursor is in there for the second reason the
   * catalogue gives as well — on a check-in-ordered page it narrows the same column the
   * date window narrows.
   */
  private async findPage(
    scope: Prisma.BookingWhereInput,
    query: BookingQuery,
    cursor: BookingCursor | null,
  ): Promise<Page<Booking>> {
    const rows = await this.prismaService.booking.findMany({
      where: {
        AND: [
          scope,
          bookingFilters(query),
          ...(cursor === null ? [] : [afterCursor(cursor)]),
        ],
      },
      include: BOOKING_INCLUDE,
      orderBy: ORDER_BY[query.sort],
      take: query.limit + 1,
    });

    return {
      items: rows.slice(0, query.limit).map(toBooking),
      hasMore: rows.length > query.limit,
    };
  }
}

/**
 * The filters of `GET /bookings`, as a `where`. `undefined` is how Prisma spells "no
 * condition", so an absent filter needs no branch of its own — what does need one is the
 * date window, because it is a pair of comparisons rather than one.
 *
 * The window is an overlap and not a bound on the check-in: a stay touches these dates if
 * it starts before the window ends and ends after it starts. That is `overlapping`,
 * the same half-open comparison the transaction in `create` refuses a double booking with,
 * so a list of stays and the rule that made them cannot disagree about what "these dates"
 * means.
 */
function bookingFilters(query: BookingQuery): Prisma.BookingWhereInput {
  const { from, to } = query;

  return {
    status: query.status,
    listingId: query.listingId,
    guestId: query.guestId,
    ...(from !== undefined && to !== undefined ? overlapping(from, to) : {}),
  };
}

/**
 * What a list of stays is ordered by, one entry per value the contract offers.
 *
 * The tiebreaker follows the direction of the key rather than being fixed, which is an
 * index decision and not a matter of taste — see the note in `listing.repository.ts`: the
 * ascending and the descending pair are exact reverses, so one btree answers both.
 *
 * The indexes that serve these are declared on the model (`schema.prisma`) rather than in
 * raw SQL, because nothing about them is partial: `(created_at DESC, id DESC)` and
 * `(from_date DESC, id DESC)` for the admin's scope, each of them again behind `guest_id`
 * for a guest's own stays. The owner's scope is the one that gets none of its own: it
 * narrows by a column of `listings`, so no index of this table can hold both halves, and
 * an owner's stays are bounded by their listings rather than by the site. Changing
 * `ORDER_BY` means changing those declarations and `afterCursor` with it.
 */
const ORDER_BY: Record<BookingSort, Prisma.BookingOrderByWithRelationInput[]> =
  {
    ...CREATED_AT_ORDER,
    checkInAsc: [{ from: "asc" }, { id: "asc" }],
    checkInDesc: [{ from: "desc" }, { id: "desc" }],
  };

/**
 * Everything that sorts after the cursor row under the ordering it was issued in: past the
 * key, or level with it and past the id. It is written as a comparison against the values
 * the cursor carries rather than through Prisma's own `cursor` option, because that one
 * resolves the row by id first — and a booking cancelled between two pages is still there,
 * but one deleted with its guest's account is not.
 *
 * Each branch says the key twice, and the redundant half is the one the index uses: an
 * `OR` gives Postgres no start position, so the inclusive bound beside it is what turns a
 * page deep in the list into a seek rather than the scan an offset would cost. The reason
 * is written out in full in `listing.repository.ts`.
 *
 * The switch is exhaustive, which is what keeps it in step with `ORDER_BY` above and with
 * `booking-cursor.ts`: a fifth ordering in the contract stops compiling in all three.
 */
function afterCursor(cursor: BookingCursor): Prisma.BookingWhereInput {
  switch (cursor.sort) {
    case "newest":
    case "oldest":
      return afterCreatedAt(cursor);
    case "checkInAsc":
      return {
        from: { gte: cursor.from },
        OR: [
          { from: { gt: cursor.from } },
          { from: cursor.from, id: { gt: cursor.id } },
        ],
      };
    case "checkInDesc":
      return {
        from: { lte: cursor.from },
        OR: [
          { from: { lt: cursor.from } },
          { from: cursor.from, id: { lt: cursor.id } },
        ],
      };
  }
}

/**
 * The names Postgres gives the two foreign keys of `bookings`; they are written down in
 * `migration.sql` under `prisma/migrations`, which is what makes them a fact of the
 * schema rather than a guess about Prisma's naming.
 */
const LISTING_FOREIGN_KEY = "bookings_listing_id_fkey";
const GUEST_FOREIGN_KEY = "bookings_guest_id_fkey";

/**
 * A foreign key violation names the key by index rather than by column, unlike the unique
 * conflict in `user.repository.ts`; the path to the constraint is the shared one.
 */
const foreignKeyConstraintSchema = z.object({ index: z.string() });

/**
 * `null` for a constraint this cannot read, and the caller then rethrows the Prisma error
 * as a 500. That is deliberate, and the opposite of what `conflictsOnEmail` decides: with
 * two candidate keys a fallback would have to pick one, and both wrong answers are worse
 * than an honest failure — a 404 about a listing that is there, or a 401 that ends a
 * session which never expired.
 */
function violatedForeignKey(
  error: Prisma.PrismaClientKnownRequestError,
): string | null {
  return violatedConstraint(error, foreignKeyConstraintSchema)?.index ?? null;
}
