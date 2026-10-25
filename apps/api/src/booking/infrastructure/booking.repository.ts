import { Injectable } from "@nestjs/common";
import {
  BookingStatus,
  type BookedRange,
  type Booking,
  type BookingQuery,
  type BookingSort,
  type CreateBookingInput,
  type StayNotice,
} from "@repo/contracts";
import { z } from "zod";
import {
  type Prisma,
  ReviewKind,
  type Booking as BookingRow,
  type Listing as ListingRow,
  type Review as ReviewRow,
} from "../../generated/prisma/client";
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
import { toIsoDate } from "../../prisma/iso-date";
import { PrismaService } from "../../prisma/prisma.service";
import type { BookingCursor } from "../application/booking-cursor";
import { ACTIVE_STATUSES, holdExpiry } from "../domain/booking-status";
import { LeaseBusyError, whileLeased, type LeaseTiming } from "./booking-lease";
import { MAX_CHARGE, MIN_CHARGE, quoteStay } from "../domain/stay-price";

/**
 * What `create` throws instead of letting a Prisma error code reach the service. The
 * listing key is now checked under the `FOR UPDATE` lock rather than at the insert, so an
 * insert only reaches this for the guest key — but the translation is kept whole, because
 * `test/booking.repository.e2e-spec.ts` still drives both sides directly.
 */
export class ListingNotFoundError extends Error {
  constructor(listingId: string) {
    super(`Listing ${listingId} not found`);
    this.name = "ListingNotFoundError";
  }
}

/**
 * The other row an insert can fail on, and the one nothing checks beforehand: the guest is
 * whoever the access token names, and `JwtStrategy` reads no database, so an account
 * deleted mid-session keeps minting valid requests for as long as `JWT_ACCESS_TTL`. That
 * is an ended session rather than a missing listing — the service answers it the way
 * `/auth/me` answers a token whose row is gone.
 */
export class GuestNotFoundError extends Error {
  constructor(guestId: string) {
    super(`Guest ${guestId} not found`);
    this.name = "GuestNotFoundError";
  }
}

/**
 * The guest owns the listing they asked to book. Read off the same locked row as the
 * existence check, so it costs no query of its own; the service answers it the way
 * starting a conversation about one's own listing is answered.
 */
export class OwnListingError extends Error {
  constructor(listingId: string) {
    super(`Listing ${listingId} is your own`);
    this.name = "OwnListingError";
  }
}

/**
 * The dates asked for overlap an active stay on that listing. Raised from inside the
 * locking transaction — either by the explicit overlap check or, if a bug slips past it,
 * by the `EXCLUDE` constraint. The service turns both into one `409`.
 */
export class DatesUnavailableError extends Error {
  constructor(input: CreateBookingInput) {
    super(
      `Listing ${input.listingId} is already booked for an overlapping range (${input.from} to ${input.to})`,
    );
    this.name = "DatesUnavailableError";
  }
}

/**
 * The stay costs more than one payment can carry — see `MAX_CHARGE`. Raised under the
 * lock, once the quote exists, so nothing is inserted; the service answers it with a `422`.
 */
export class StayTooExpensiveError extends Error {
  constructor(amount: number) {
    super(
      `A stay costing ${amount.toFixed(2)} is more than one payment can carry (${MAX_CHARGE.toFixed(2)})`,
    );
    this.name = "StayTooExpensiveError";
  }
}

/** The stay costs less than one payment can carry — see `MIN_CHARGE`. Raised like the above. */
export class StayTooCheapError extends Error {
  constructor(amount: number) {
    super(
      `A stay costing ${amount.toFixed(2)} is less than one payment can carry (${MIN_CHARGE.toFixed(2)})`,
    );
    this.name = "StayTooCheapError";
  }
}

/**
 * Another cancellation of the same stay — or the webhook of its refund — held it for longer
 * than `whileCancelling` waits. The service answers it with a `409` worth retrying, the
 * webhook with a `500` and a redelivery.
 */
export class CancellationInProgressError extends Error {
  constructor(id: string) {
    super(`Booking ${id} is being cancelled by another request`);
    this.name = "CancellationInProgressError";
  }
}

/**
 * The owner of the listing is kept beside the booking rather than inside it: the
 * authorization rules need that column, the contract does not have it, and a flat shape
 * would let a `return booking` carry it into a response body without the types or the
 * review noticing. The payment is the same case — the id of a PaymentIntent is what
 * cancelling and refunding are done through, and nothing a reader of the booking needs.
 */
export type BookingWithListingOwner = {
  booking: Booking;
  listingOwnerId: string;
  paymentId: string | null;
};

/**
 * A hold one of the three expiry paths let go of, with the two people it concerned. Not a
 * `Booking`: the row is read back by the `UPDATE` that released it, and what is said about
 * it afterwards is a notice — so it carries what a notice copies and nothing a response
 * body would want.
 */
export type ReleasedHold = {
  stay: StayNotice;
  guestId: string;
  listingOwnerId: string;
  /** The payment opened for the hold, which has to be withdrawn now it can never complete. */
  paymentId: string | null;
};

/**
 * A hold the payment webhook turned into a stay — the same three things a released one
 * carries, because the same two people are told about it.
 */
export type ConfirmedStay = ReleasedHold;

/** What a cancellation leaves behind: the payment the row named when it was cancelled. */
export type CancelledStay = {
  paymentId: string | null;
};

/**
 * A stay's money as the payment handlers read it — found by its payment, or by the booking a
 * payment names. The payout side extends it with its own columns (`SettledStay`).
 */
export type RefundTarget = {
  bookingId: string;
  status: BookingStatus;
  amount: number;
  /** What the stay records as refunded so far; `null` before anything went back. */
  refundedAmount: number | null;
  /** What a cancellation decided to give back and has not sent yet. */
  refundOwed: number | null;
  /** A payment turned this booking into a stay at some point, whatever its status now. */
  paid: boolean;
  /** Both sides were told of the confirmation and the payout scheduled — see the column. */
  confirmationAnnounced: boolean;
  hold: ReleasedHold;
};

/**
 * What `create` hands back: the new hold, and the lapsed holds of the same listing its
 * transaction released on the way — those are only released if the hold is taken, because
 * a refusal rolls the release back with it.
 */
export type CreatedBooking = BookingWithListingOwner & {
  released: ReleasedHold[];
};

/** One row of the `FOR UPDATE` read — raw SQL, so the column keeps its stored name. */
type LockedListing = {
  id: string;
  owner_id: string;
  deleted_at: Date | null;
};

/**
 * What every read of a booking selects from the listing it names, and it is not narrowed
 * by `deleted_at`: a retired listing is still where the stay was, and resolving it here is
 * the only way its guest ever learns the title again — see `listingSummarySchema` in the
 * contract. Any extra column a caller selects alongside it (the owner, for the
 * authorization rules) stays out of the answer, because `toBooking` names the two fields
 * it copies rather than spreading the row.
 */
const LISTING_SUMMARY = {
  listing: { select: { title: true, pricePerNight: true } },
} satisfies Prisma.BookingInclude;

/**
 * Which halves of the stay have been reviewed, read beside the listing on every booking —
 * the contract's `reviewed`. The kinds and nothing else: what a review says is read through
 * the lists that are scoped for it, and a booking is read by both of the people it names.
 * At most two rows, found through the unique `(booking_id, kind)` pair.
 */
const REVIEW_KINDS = {
  reviews: { select: { kind: true } },
} satisfies Prisma.BookingInclude;

/** Everything `toBooking` reads off a row besides its own columns. */
const BOOKING_INCLUDE = {
  ...LISTING_SUMMARY,
  ...REVIEW_KINDS,
} satisfies Prisma.BookingInclude;

/**
 * What a released hold is read back with: the listing's title for the notice and its owner
 * for the recipient. `updateManyAndReturn` loads to-one relations only, which is all this
 * needs — the reviews `toBooking` reads are not wanted here.
 */
export const RELEASED_HOLD_INCLUDE = {
  listing: { select: { title: true, ownerId: true } },
} satisfies Prisma.BookingIncludeUpdateManyAndReturn;

/**
 * A stored booking with the listing columns the contract's `listing` is built from. Taken
 * off the row rather than off `ListingSummary`: the price is a `numeric` column and
 * therefore a `Decimal` here, while the contract speaks a `number` — `toBooking` is where
 * the two meet.
 */
type BookingRowWithListing = BookingRow & {
  listing: Pick<ListingRow, "title" | "pricePerNight">;
  reviews: Pick<ReviewRow, "kind">[];
};

/**
 * Every query the module makes, and the whole of its knowledge about how a stay is stored:
 * that dates live in `@db.Date` columns while the contract speaks `YYYY-MM-DD`, that a
 * stay has a status and only two of the four hold the slot, and that an overlap is a pair
 * of strict inequalities.
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
      include: {
        ...REVIEW_KINDS,
        listing: {
          select: { ...LISTING_SUMMARY.listing.select, ownerId: true },
        },
      },
    });

    if (row === null) return null;

    return {
      booking: toBooking(row),
      listingOwnerId: row.listing.ownerId,
      paymentId: row.paymentIntentId,
    };
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
   *  4. quote the stay off the listing's prices (`quoteStay`), read under the same lock.
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
        SELECT id, owner_id, deleted_at FROM listings WHERE id = ${input.listingId}::uuid FOR UPDATE
      `;

      const listing = locked[0];

      if (listing === undefined || listing.deleted_at !== null) {
        throw new ListingNotFoundError(input.listingId);
      }

      if (listing.owner_id === guestId) {
        throw new OwnListingError(input.listingId);
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

      // The quote is taken under the same lock as the nights, so a save of the listing's
      // prices — which writes this row first — either lands before it or waits for it.
      const priced = await readPricedListing(tx, input.listingId, input);

      if (priced === null) {
        throw new ListingNotFoundError(input.listingId);
      }

      const amount = quoteStay(priced, input.from, input.to);

      if (amount > MAX_CHARGE) {
        throw new StayTooExpensiveError(amount);
      }

      if (amount < MIN_CHARGE) {
        throw new StayTooCheapError(amount);
      }

      try {
        const row = await tx.booking.create({
          data: {
            listingId: input.listingId,
            guestId,
            from: new Date(input.from),
            to: new Date(input.to),
            status: BookingStatus.PENDING_PAYMENT,
            expiresAt: holdExpiry(now),
            amount,
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

  /**
   * Cancelling keeps the row and moves it out of the active set: the record is what phase
   * 5 refunds against, and an inactive status frees the slot the `EXCLUDE` constraint
   * guards. `expiresAt` is left where it is — the deadline this hold had is part of that
   * record, and `status` is what says it no longer holds anything. `false` is the row
   * already being gone from the active set — cancelled or expired by another request
   * between the read that authorized this one and here. `updateMany` reports that in a
   * count instead of an exception, the same trade the old `delete` made with `deleteMany`.
   *
   * What the cancellation gives back is written in the same statement (`refund_owed`), so
   * it is never answered while the money it owes is written nowhere. It matches only the
   * status the refund was decided by — `null` for a hold confirmed in between too — and
   * reads the payment back from the `UPDATE`, so one attached meanwhile is withdrawn.
   */
  async cancel(
    id: string,
    status: BookingStatus,
    refundOwed: number | null,
  ): Promise<CancelledStay | null> {
    const [cancelled] = await this.prismaService.booking.updateManyAndReturn({
      where: {
        id,
        AND: [{ status: { in: [...ACTIVE_STATUSES] } }, { status }],
      },
      data: { status: BookingStatus.CANCELLED, refundOwed },
      select: { paymentIntentId: true },
    });

    return cancelled === undefined
      ? null
      : { paymentId: cancelled.paymentIntentId };
  }

  /**
   * The cancellations whose refund has not gone out yet — a job lost with Redis, or one
   * Stripe kept refusing — at most `limit` of them; the sweep after this one reads the
   * rest. The partial index makes this read nothing on the usual minute. A stay whose
   * cancellation lease is running is left to whoever holds it — usually the refund job
   * itself — rather than waited for and logged as busy.
   *
   * Raw SQL, because the lease is compared on the database's clock, the one it was written
   * with (`whileLeased`), and Prisma's `where` can only compare against a value this
   * process sends.
   */
  async findOwedRefunds(limit: number): Promise<string[]> {
    const rows = await this.prismaService.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM bookings
      WHERE refund_owed IS NOT NULL
        AND (cancelling_until IS NULL OR cancelling_until <= (now() AT TIME ZONE 'UTC'))
      ORDER BY id
      LIMIT ${limit}
    `;

    return rows.map(({ id }) => id);
  }

  /**
   * The refund total raised and the debt cleared in one transaction — apart, the host's
   * share would count the refund twice. `total` is `null` when nothing went out after all.
   * The total only rises, so a webhook that raised it to Stripe's figure is not written over.
   */
  async settleOwedRefund(id: string, total: number | null): Promise<void> {
    await this.prismaService.$transaction([
      ...(total === null
        ? []
        : [
            this.prismaService.booking.updateMany({
              where: {
                id,
                OR: [
                  { refundedAmount: null },
                  { refundedAmount: { lt: total } },
                ],
              },
              data: { refundedAmount: total },
            }),
          ]),
      this.prismaService.booking.updateMany({
        where: { id },
        data: { refundOwed: null },
      }),
    ]);
  }

  /**
   * Runs `work` under the per-booking cancellation lease (`whileLeased`), which a
   * cancellation, the job that sends its refund and the payment webhooks take. The job
   * refunds before it records the refund, so the webhook that reports that refund waits
   * here instead of reading the stay half way — and finds it recorded, or records it itself
   * after a job that died in between.
   */
  async whileCancelling<T>(id: string, work: () => Promise<T>): Promise<T> {
    try {
      return await whileLeased(
        this.prismaService,
        "cancelling_until",
        id,
        CANCEL_LEASE,
        work,
      );
    } catch (error) {
      if (error instanceof LeaseBusyError) {
        throw new CancellationInProgressError(id);
      }

      throw error;
    }
  }

  /**
   * Remembers which PaymentIntent was opened for a hold — only into an empty column (or
   * the same id again), and only while the hold is pending. `false` is a hold released
   * while Stripe answered: the caller withdraws the payment instead of handing it out.
   */
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
   * A hold whose payment succeeded becomes a stay — any `PENDING_PAYMENT` row, whatever its
   * deadline: a lapsed hold no path has released still holds its nights. A released or
   * cancelled one matches nothing and the caller refunds. Read back from the `UPDATE`, so of
   * two runs over one payment only one is told. The charge funds the host's transfer later.
   */
  async confirmPayment(
    id: string,
    paymentId: string,
    chargeId: string | null,
    amount: number,
  ): Promise<ConfirmedStay | null> {
    const [confirmed] = await this.prismaService.booking.updateManyAndReturn({
      where: {
        id,
        status: BookingStatus.PENDING_PAYMENT,
        // A payment that took another sum than the stay was quoted confirms nothing and is
        // given back like a late one; only this API opens payments, so it is a safeguard.
        amount,
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

  /**
   * The steps after a confirmation are done: both sides were told and the payout scheduled.
   * Written after them, so a delivery that dies before this is repeated by the next one.
   */
  async markConfirmationAnnounced(id: string): Promise<void> {
    await this.prismaService.booking.updateMany({
      where: { id, confirmationAnnouncedAt: null },
      data: { confirmationAnnouncedAt: new Date() },
    });
  }

  /** What a payment that confirmed nothing finds in its place — see `RefundTarget`. */
  async findPaymentTarget(id: string): Promise<RefundTarget | null> {
    return this.readRefundTarget({ id });
  }

  /**
   * What went back of a payment that arrived for nights no longer the guest's — only into
   * an empty column, so of two runs racing only the one that wrote it tells the guest.
   */
  async recordRefund(id: string, amount: number): Promise<boolean> {
    const { count } = await this.prismaService.booking.updateMany({
      where: { id, refundedAmount: null },
      data: { refundedAmount: amount },
    });

    return count > 0;
  }

  /** What a refund event names: the payment, which is unique to one stay. */
  async findRefundTarget(paymentId: string): Promise<RefundTarget | null> {
    return this.readRefundTarget({ paymentIntentId: paymentId });
  }

  private async readRefundTarget(
    where: Prisma.BookingWhereUniqueInput,
  ): Promise<RefundTarget | null> {
    const row = await this.prismaService.booking.findUnique({
      where,
      include: RELEASED_HOLD_INCLUDE,
    });

    return row === null ? null : toRefundTarget(row);
  }

  /**
   * Raises a paid stay's refund total to Stripe's, from exactly what was read; refunds only
   * add up, so an older event never lowers it.
   */
  async raiseRefunded(
    id: string,
    from: number | null,
    to: number,
  ): Promise<boolean> {
    const { count } = await this.prismaService.booking.updateMany({
      where: { id, paidAt: { not: null }, refundedAmount: from },
      data: { refundedAmount: to },
    });

    return count > 0;
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
 * The stays taken against this owner's listings — the owner's scope, written once because
 * two reads narrow by it: the page of stays above, and the lookups that suggest what that
 * page can be filtered by (`LookupRepository`), which must not offer an owner a guest or a
 * listing their own list would never show.
 */
export function againstListingsOf(ownerId: string): Prisma.BookingWhereInput {
  return { listing: { ownerId } };
}

/**
 * The filters of `GET /bookings`, as a `where`. `undefined` is how Prisma spells "no
 * condition", so an absent filter needs no branch of its own — what does need one is the
 * date window, because it is a pair of comparisons rather than one.
 *
 * The window is an overlap and not a bound on the check-in: a stay touches these dates if
 * it starts before the window ends and ends after it starts. That is `overlapping` below,
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
 * A hold whose deadline has passed, written once because three writes ask for it: the
 * lazy sweep inside `create`, the job that releases one hold and the repeatable sweep
 * behind it. The boundary is inclusive: a hold is done holding the moment its deadline is
 * reached, not a millisecond after.
 */
export function lapsedHolds(now: Date): Prisma.BookingWhereInput {
  return { status: BookingStatus.PENDING_PAYMENT, expiresAt: { lte: now } };
}

/**
 * A stay that is holding its slot at this moment: active, and not a hold that has already
 * lapsed. Written as the complement of `lapsedHolds` rather than as a second list of
 * conditions, so the two cannot drift.
 *
 * Both of them read `expires_at`, and a `PENDING_PAYMENT` row with none would make both
 * NULL rather than true or false — a hold this file cannot see and the `EXCLUDE`
 * constraint still counts. That row cannot exist: `bookings_hold_has_deadline` refuses it
 * at the database, which is what lets the complement be written this simply.
 *
 * The reads that ask it are three, and one of them is in another module: `create` refuses
 * an overlap with it, `findActiveRanges` reports the ranges it matches, and
 * `ListingRepository` filters the catalogue by the listings that match none of them. The
 * exported ones are `where` clauses, which is the whole of what crosses that line —
 * everything that turns a row into a contract type stays in this file.
 */
export function holdsTheSlot(now: Date): Prisma.BookingWhereInput {
  return { status: { in: [...ACTIVE_STATUSES] }, NOT: lapsedHolds(now) };
}

/**
 * Two nights that share one: check-out is exclusive, so a stay starting the day another
 * ends is not an overlap. The strict inequalities are the same rule the `EXCLUDE`
 * constraint spells as `daterange(from, to, '[)') WITH &&`.
 */
export function overlapping(
  from: string,
  to: string,
): Prisma.BookingWhereInput {
  return { from: { lt: new Date(to) }, to: { gt: new Date(from) } };
}

/**
 * The cancellation lease. Sixty seconds is room for the refund job's work under it — a
 * refund at Stripe and the settlement of the host's payout. Three seconds of waiting keep a
 * cancellation that waits for it well inside the ten seconds the frontend's transport
 * waits; each try is an `UPDATE`, so the tries back off rather than write ten times a
 * second while Stripe is slow.
 */
const CANCEL_LEASE: LeaseTiming = {
  leaseMs: 60_000,
  waitMs: 3_000,
  pollMs: 100,
  pollMaxMs: 1_000,
};

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

function toBooking(row: BookingRowWithListing): Booking {
  return {
    id: row.id,
    listingId: row.listingId,
    // Named field by field rather than spread: a caller that selects more of the listing
    // than the summary — the owner, for the authorization rules — must not have it leak
    // into a response body.
    listing: {
      title: row.listing.title,
      pricePerNight: row.listing.pricePerNight.toNumber(),
    },
    guestId: row.guestId,
    from: toIsoDate(row.from),
    to: toIsoDate(row.to),
    status: row.status,
    amount: row.amount.toNumber(),
    refundedAmount: row.refundedAmount?.toNumber() ?? null,
    refundOwed: row.refundOwed?.toNumber() ?? null,
    paid: row.paidAt !== null,
    dispute: row.disputeStatus,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    reviewed: {
      byGuest: row.reviews.some((review) => review.kind === ReviewKind.LISTING),
      byOwner: row.reviews.some((review) => review.kind === ReviewKind.GUEST),
    },
  };
}

/** The one reading of a stay's money, which `PayoutRepository` extends with its own. */
export function toRefundTarget(
  row: BookingRow & { listing: Pick<ListingRow, "title" | "ownerId"> },
): RefundTarget {
  return {
    bookingId: row.id,
    status: row.status,
    amount: row.amount.toNumber(),
    refundedAmount: row.refundedAmount?.toNumber() ?? null,
    refundOwed: row.refundOwed?.toNumber() ?? null,
    paid: row.paidAt !== null,
    confirmationAnnounced: row.confirmationAnnouncedAt !== null,
    hold: toReleasedHold(row),
  };
}

export function toReleasedHold(
  row: BookingRow & { listing: Pick<ListingRow, "title" | "ownerId"> },
): ReleasedHold {
  return {
    stay: {
      bookingId: row.id,
      listingId: row.listingId,
      listingTitle: row.listing.title,
      from: toIsoDate(row.from),
      to: toIsoDate(row.to),
    },
    guestId: row.guestId,
    listingOwnerId: row.listing.ownerId,
    paymentId: row.paymentIntentId,
  };
}
