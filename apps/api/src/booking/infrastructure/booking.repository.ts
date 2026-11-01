import { Injectable } from "@nestjs/common";
import {
  BookingStatus,
  DisputeStatus,
  type BookedRange,
  type Booking,
  type BookingQuery,
  type BookingSort,
  type CreateBookingInput,
  type StuckKind,
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
import type { SetAside } from "../../common/job-failure";
import type { SetAsideCursor } from "../../common/set-aside-cursor";
import { readPricedListing } from "../../listing/listing-pricing";
import { toIsoDate } from "../../common/iso-date";
import { PrismaService } from "../../prisma/prisma.service";
import { ACTIVE_STATUSES, holdExpiry } from "../domain/booking-status";
import {
  CancellationInProgressError,
  DatesUnavailableError,
  GuestNotFoundError,
  ListingNotFoundError,
  OwnListingError,
} from "../domain/booking.errors";
import type {
  BookingCursor,
  BookingDetailWithListingOwner,
  BookingWithListingOwner,
  CancelledStay,
  ConfirmedStay,
  CreatedBooking,
  RefundTarget,
  ReleasedHold,
  StuckStayRow,
} from "../domain/booking.types";
import { quoteStay } from "../domain/stay-price";
import { LeaseBusyError, whileLeased, type LeaseTiming } from "./booking-lease";
import { cents, type Cents } from "../../payment/domain/money";
import {
  RELEASED_HOLD_INCLUDE,
  stayMoneyData,
  toRefundTarget,
  toReleasedHold,
  toStayMoney,
} from "./stay-rows";

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
  listing: { select: { title: true, pricePerNightCents: true } },
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

/** A stored booking with the listing columns the contract's `listing` is built from. */
type BookingRowWithListing = BookingRow & {
  listing: Pick<ListingRow, "title" | "pricePerNightCents">;
  reviews: Pick<ReviewRow, "kind">[];
};

/** `BOOKING_INCLUDE` with the listing's owner, which the authorization rules read. */
const WITH_LISTING_OWNER = {
  ...REVIEW_KINDS,
  listing: {
    select: { ...LISTING_SUMMARY.listing.select, ownerId: true },
  },
} satisfies Prisma.BookingInclude;

function withListingOwner(
  row: BookingRowWithListing & { listing: Pick<ListingRow, "ownerId"> },
): BookingWithListingOwner {
  return {
    booking: toBooking(row),
    listingOwnerId: row.listing.ownerId,
    paymentId: row.paymentIntentId,
  };
}

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
      include: WITH_LISTING_OWNER,
    });

    return row === null ? null : withListingOwner(row);
  }

  /**
   * `findByIdWithListingOwner` with what each night cost when the hold was quoted, in the
   * order of the stay, read in the same statement. Empty for a stay taken before the nights
   * were recorded.
   */
  async findDetailWithListingOwner(
    id: string,
  ): Promise<BookingDetailWithListingOwner | null> {
    const row = await this.prismaService.booking.findFirst({
      where: { id },
      include: { ...WITH_LISTING_OWNER, nights: { orderBy: { date: "asc" } } },
    });

    return row === null
      ? null
      : {
          ...withListingOwner(row),
          nights: row.nights.map((night) => ({
            date: toIsoDate(night.date),
            priceCents: cents(night.priceCents),
          })),
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

      const money = stayMoneyData(quoteStay(priced, input.from, input.to));

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
   * What the cancellation gives back is written in the same statement (`refund_owed_cents`), so
   * it is never answered while the money it owes is written nowhere. It matches only the
   * status the refund was decided by — `null` for a hold confirmed in between too — and
   * reads the payment back from the `UPDATE`, so one attached meanwhile is withdrawn.
   */
  async cancel(
    id: string,
    status: BookingStatus,
    refundOwedCents: Cents | null,
  ): Promise<CancelledStay | null> {
    const [cancelled] = await this.prismaService.booking.updateManyAndReturn({
      where: {
        id,
        AND: [{ status: { in: [...ACTIVE_STATUSES] } }, { status }],
      },
      data: {
        status: BookingStatus.CANCELLED,
        refundOwedCents,
      },
      select: { paymentIntentId: true },
    });

    return cancelled === undefined
      ? null
      : { paymentId: cancelled.paymentIntentId };
  }

  /**
   * The debts still owed, the fewest failures first. A stay under a running lease is left
   * to its holder, and one under an open dispute to the outcome. Raw SQL, because the lease
   * is compared on the database's clock, which Prisma's `where` cannot name.
   */
  async findOwedRefunds(limit: number): Promise<string[]> {
    const rows = await this.prismaService.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM bookings
      WHERE refund_owed_cents IS NOT NULL
        AND refund_failed_at IS NULL
        AND dispute_status IS DISTINCT FROM 'OPEN'
        AND (cancelling_until IS NULL OR cancelling_until <= (now() AT TIME ZONE 'UTC'))
      ORDER BY refund_attempts, id
      LIMIT ${limit}
    `;

    return rows.map(({ id }) => id);
  }

  /**
   * The stays whose owed refund or host payout was set aside, newest first. Each kind reads
   * its own partial index (`bookings_refund_failed_idx`, `bookings_payout_failed_idx`); the
   * payout's columns are `PayoutRepository`'s to write, and only read here, because the
   * row a stay is answered with is this repository's mapping.
   */
  async findStuckPage(
    kind: StuckKind,
    cursor: SetAsideCursor | null,
    limit: number,
  ): Promise<Page<StuckStayRow>> {
    const isRefund = kind === "refund";
    const column = isRefund ? "refundFailedAt" : "payoutFailedAt";
    const after: Prisma.BookingWhereInput =
      cursor === null
        ? {}
        : {
            [column]: { lte: cursor.at },
            OR: [
              { [column]: { lt: cursor.at } },
              { [column]: cursor.at, id: { lt: cursor.id } },
            ],
          };
    const rows = await this.prismaService.booking.findMany({
      where: {
        AND: [
          isRefund
            ? STUCK_REFUND
            : stuckPayout(this.prismaService.booking.fields),
          after,
        ],
      },
      include: BOOKING_INCLUDE,
      orderBy: [{ [column]: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    return {
      items: rows.slice(0, limit).flatMap((row) => {
        const { failedAt, attempts, lastError } = isRefund
          ? {
              failedAt: row.refundFailedAt,
              attempts: row.refundAttempts,
              lastError: row.refundLastError,
            }
          : {
              failedAt: row.payoutFailedAt,
              attempts: row.payoutAttempts,
              lastError: row.payoutLastError,
            };

        if (failedAt === null) return [];

        return [
          {
            kind,
            booking: toBooking(row),
            attempts,
            lastError,
            failedAt: failedAt.toISOString(),
          },
        ];
      }),
      hasMore: rows.length > limit,
    };
  }

  /**
   * Hands a set-aside debt back to the sweep with a whole count of attempts. `false` for a
   * stay whose refund is not set aside — or that is not there.
   */
  async handBackRefund(id: string): Promise<boolean> {
    const { count } = await this.prismaService.booking.updateMany({
      where: { id, ...STUCK_REFUND },
      data: { refundFailedAt: null, refundAttempts: 0 },
    });

    return count > 0;
  }

  /**
   * Sets the debt aside at `maxAttempts`. Two conditional steps, so of two runs failing at
   * once only one reports it. `null` for a debt no longer pending.
   */
  async recordRefundFailure(
    id: string,
    error: string,
    maxAttempts: number,
  ): Promise<SetAside | null> {
    const pending = {
      id,
      refundOwedCents: { not: null },
      refundFailedAt: null,
    } satisfies Prisma.BookingWhereInput;
    const [counted] = await this.prismaService.booking.updateManyAndReturn({
      where: pending,
      data: { refundAttempts: { increment: 1 }, refundLastError: error },
      select: { refundAttempts: true },
    });

    if (counted === undefined) return null;

    if (counted.refundAttempts < maxAttempts) {
      return { attempts: counted.refundAttempts, setAside: false };
    }

    const { count } = await this.prismaService.booking.updateMany({
      where: pending,
      data: { refundFailedAt: new Date() },
    });

    return { attempts: counted.refundAttempts, setAside: count > 0 };
  }

  /**
   * One transaction, or the host's share would count the refund twice. `total` is `null`
   * when nothing went out; it only rises, so Stripe's figure from a webhook is kept.
   */
  async settleOwedRefund(id: string, total: Cents | null): Promise<void> {
    await this.prismaService.$transaction([
      ...(total === null
        ? []
        : [
            this.prismaService.booking.updateMany({
              where: {
                id,
                OR: [
                  { refundedAmountCents: null },
                  { refundedAmountCents: { lt: total } },
                ],
              },
              data: { refundedAmountCents: total },
            }),
          ]),
      this.prismaService.booking.updateMany({
        where: { id },
        data: {
          refundOwedCents: null,
          refundAttempts: 0,
          refundLastError: null,
        },
      }),
    ]);
  }

  /**
   * The cancellation lease, which the refund job and the payment webhooks take too: the
   * webhook reporting a refund waits here instead of reading the stay half way.
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

  async findPaymentTarget(id: string): Promise<RefundTarget | null> {
    return this.readRefundTarget({ id });
  }

  /** Only into an empty column, so of two runs only the one that wrote it tells the guest. */
  async recordRefund(id: string, amount: Cents): Promise<boolean> {
    const { count } = await this.prismaService.booking.updateMany({
      where: { id, refundedAmountCents: null },
      data: { refundedAmountCents: amount },
    });

    return count > 0;
  }

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

  /** From exactly what was read, so an older event never lowers it. */
  async raiseRefunded(
    id: string,
    from: Cents | null,
    to: Cents,
  ): Promise<boolean> {
    const { count } = await this.prismaService.booking.updateMany({
      where: {
        id,
        paidAt: { not: null },
        refundedAmountCents: from,
      },
      data: { refundedAmountCents: to },
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
 * A paid stay whose host may still be sent a transfer — the coarse cut `findDuePayouts` and
 * `stuckPayout` both read, written once so the sweep and the admin's list cannot drift. A
 * stay refunded in full or a dispute lost left the host nothing to send, and nothing leaves
 * while a dispute is open; the exact amount is the service's rule. A refund still on its way
 * is sent first, and the stay comes back once it is recorded.
 */
export function payoutOwed(
  fields: Prisma.BookingFieldRefs,
): Prisma.BookingWhereInput {
  return {
    paidAt: { not: null },
    transferId: null,
    refundOwedCents: null,
    AND: [
      { OR: [{ disputeStatus: null }, { disputeStatus: DisputeStatus.WON }] },
      {
        OR: [
          { refundedAmountCents: null },
          { refundedAmountCents: { lt: fields.amountCents } },
        ],
      },
    ],
  };
}

/**
 * Whether the stay is there at all — what tells a refused retry's `409` from its `404`, in
 * both modules that retry something set aside on a stay.
 */
export async function bookingExists(
  prismaService: PrismaService,
  id: string,
): Promise<boolean> {
  return (await prismaService.booking.count({ where: { id } })) > 0;
}

/**
 * A payout set aside that is still owed — what `GET /bookings/stuck?kind=payout` lists and
 * what `PayoutRepository.handBackPayout` hands back, written once so a retry is refused for
 * exactly the stays the list leaves out: one a retry would only find owing nothing again,
 * held by an open dispute or waiting on a refund still owed. A dispute won, or the refund
 * recorded, brings the row back to the list.
 */
export function stuckPayout(
  fields: Prisma.BookingFieldRefs,
): Prisma.BookingWhereInput {
  return { AND: [payoutOwed(fields), { payoutFailedAt: { not: null } }] };
}

/** A debt set aside — still owed, which is what a retry hands back. */
const STUCK_REFUND = {
  refundFailedAt: { not: null },
  refundOwedCents: { not: null },
} satisfies Prisma.BookingWhereInput;

/**
 * Sixty seconds of room for a refund and a settlement; three of waiting keep a cancellation
 * inside the frontend's ten. Each try is an `UPDATE`, so the tries back off.
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
      pricePerNightCents: cents(row.listing.pricePerNightCents),
    },
    guestId: row.guestId,
    from: toIsoDate(row.from),
    to: toIsoDate(row.to),
    status: row.status,
    ...toStayMoney(row),
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
