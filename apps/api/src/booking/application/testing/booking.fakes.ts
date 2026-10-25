import { tz } from "@date-fns/tz";
import { Test } from "@nestjs/testing";
import { addDays, format, parseISO } from "date-fns";
import { randomUUID } from "node:crypto";
import {
  bookingQuerySchema,
  BookingStatus,
  Role,
  type BookedRange,
  type Booking,
  type BookingQuery,
  type BookingSort,
  type CreateBookingInput,
  type ListingSummary,
  type NotificationContent,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../../auth/auth.types";
import type { SetAside } from "../../../common/job-failure";
import type { Page } from "../../../common/paging";
import { NotificationService } from "../../../notification/notification.service";
import { PaymentEventDispatcher } from "../../../payment/application/payment-event-dispatcher";
import {
  PaymentGateway,
  PaymentOpeningInProgressError,
  type OpenedPayment,
  type PaymentEvent,
} from "../../../payment/application/ports/payment-gateway";
import { WaitlistService } from "../../../waitlist/waitlist.service";
import type { FreedNights } from "../../../waitlist/waitlist.types";
import { ACTIVE_STATUSES, holdExpiry } from "../../domain/booking-status";
import {
  CancellationInProgressError,
  DatesUnavailableError,
  GuestNotFoundError,
  ListingNotFoundError,
  OwnListingError,
} from "../../domain/booking.errors";
import type {
  BookingCursor,
  BookingWithListingOwner,
  CancelledStay,
  ConfirmedStay,
  CreatedBooking,
  RefundTarget,
  ReleasedHold,
} from "../../domain/booking.types";
import { BookingRepository } from "../../infrastructure/booking.repository";
import {
  RefundFailureRepository,
  type RefundFailure,
} from "../../infrastructure/refund-failure.repository";
import { BookingPaymentHandler } from "../booking-payment.handler";
import { BookingService, stayNoticeOf } from "../booking.service";
import { BookingJobs } from "../ports/booking-jobs";
import { StayLifecycle, type StayListener } from "../stay-lifecycle";

/*
 * What `booking.service.spec.ts` and `booking-payment.handler.spec.ts` share: the fixtures,
 * the fakes of everything around the two classes, and the module both are built in — one
 * module, because the handler's news and the service's cancellations act on the same rows.
 * Kept out of the build by `tsconfig.build.json` (`*.fakes.ts`).
 */
export const GUEST_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
export const OWNER_ID = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";
export const STRANGER_ID = "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f50";
export const LISTING_ID = "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b";
export const OTHER_LISTING_ID = "3a4b5c6d-7e8f-4091-8a2b-3c4d5e6f7a8b";

/** What the repository resolves beside every stay; no rule in this service reads it. */
export const listing: ListingSummary = {
  title: "Loft above the harbour",
  pricePerNight: 120,
};

export const input: CreateBookingInput = {
  listingId: LISTING_ID,
  from: "2026-09-01",
  to: "2026-09-05",
};

/** What every stay the fake takes costs; the quote itself is `quoteStay`'s and the e2e's. */
export const AMOUNT = 480;

export const IN_UTC = { in: tz("UTC") };

export const day = (offset: number): string =>
  format(addDays(parseISO("2026-09-01", IN_UTC), offset), "yyyy-MM-dd");

/**
 * The nth stay of a fixture that needs several: a week apart, so no two of them overlap
 * and the fake refuses none — what these specs are about is the paging and the ordering,
 * not the slot.
 */
export const stayAfter = (index: number): CreateBookingInput => ({
  ...input,
  from: day(index * 7),
  to: day(index * 7 + 2),
});

export const userWith = (id: string, role: Role): AuthenticatedUser => ({
  id,
  email: "someone@example.com",
  role,
});

export const guest = userWith(GUEST_ID, Role.USER);
export const owner = userWith(OWNER_ID, Role.USER);
export const stranger = userWith(STRANGER_ID, Role.USER);
export const admin = userWith(STRANGER_ID, Role.ADMIN);

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
export type PublicOf<T> = { [K in keyof T]: T[K] };

/**
 * A query as it reaches the service: parsed by the contract rather than written out, so a
 * spec never states a default the API does not have.
 */
export const searchFor = (search: Record<string, string> = {}): BookingQuery =>
  bookingQuerySchema.parse(search);

export const compare = (left: string, right: string): number => {
  if (left < right) return -1;

  return left > right ? 1 : 0;
};

/** The four orderings of the contract, with the tiebreaker following the key. */
export const ordering =
  (sort: BookingSort) =>
  (left: Booking, right: Booking): number => {
    switch (sort) {
      case "newest":
        return (
          compare(right.createdAt, left.createdAt) || compare(right.id, left.id)
        );
      case "oldest":
        return (
          compare(left.createdAt, right.createdAt) || compare(left.id, right.id)
        );
      case "checkInAsc":
        return compare(left.from, right.from) || compare(left.id, right.id);
      case "checkInDesc":
        return compare(right.from, left.from) || compare(right.id, left.id);
    }
  };

export const isActive = (booking: Booking): boolean =>
  ACTIVE_STATUSES.includes(booking.status);

/**
 * The repository is faked rather than mocked: what the rules here decide is which rows a
 * caller ends up with and which ones are refused. The overlap semantics, the locking
 * transaction and the date mapping belong to the repository, so they are covered by e2e
 * against a real database instead of restated here — the fake only has to reject an
 * overlap with an active row so the service's `409` translation is exercised.
 *
 * Reads return a row whatever its status, and only the rules about the slot — the overlap
 * on create, what `cancel` will still accept — narrow to the active ones. That is the
 * repository's shape, and getting it wrong here would let the spec assert a booking
 * disappears when the API says it turns `CANCELLED`.
 */
export class FakeBookingRepository implements PublicOf<BookingRepository> {
  readonly rows = new Map<string, BookingWithListingOwner>();

  /** The listing this fake creates bookings against, unless the row says otherwise. */
  listingOwnerId = OWNER_ID;

  /** Set to have `create` lose the race the pre-flight check cannot close. */
  vanishingListing = false;

  /** Set to have `create` fail on the other key: the account behind the token is gone. */
  vanishingGuest = false;

  /**
   * The holds whose deadline has passed. The fake keeps no clock: a spec names the holds it
   * wants lapsed, and the three expiry paths release exactly those that are still pending.
   */
  readonly lapsed = new Set<string>();

  /**
   * Run just before `cancel` or `attachPayment` writes, as a request racing the one under
   * test would between its read and its write.
   */
  racing: ((id: string) => Promise<unknown>) | null = null;

  /** The bookings whose cancellation lease another run holds past the wait. */
  readonly held = new Set<string>();

  findPageForEveryone(
    query: BookingQuery,
    cursor: BookingCursor | null,
  ): Promise<Page<Booking>> {
    return this.pageOf(this.allBookings(), query, cursor);
  }

  findPageForGuest(
    guestId: string,
    query: BookingQuery,
    cursor: BookingCursor | null,
  ): Promise<Page<Booking>> {
    return this.pageOf(
      this.allBookings().filter((booking) => booking.guestId === guestId),
      query,
      cursor,
    );
  }

  findPageForListingOwner(
    ownerId: string,
    query: BookingQuery,
    cursor: BookingCursor | null,
  ): Promise<Page<Booking>> {
    return this.pageOf(
      [...this.rows.values()]
        .filter((found) => found.listingOwnerId === ownerId)
        .map((found) => found.booking),
      query,
      cursor,
    );
  }

  findByIdWithListingOwner(
    id: string,
  ): Promise<BookingWithListingOwner | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  hasStayedWith(guestId: string, ownerId: string): Promise<boolean> {
    return Promise.resolve(
      [...this.rows.values()].some(
        (found) =>
          found.booking.guestId === guestId &&
          found.listingOwnerId === ownerId &&
          isActive(found.booking),
      ),
    );
  }

  create(
    guestId: string,
    booking: CreateBookingInput,
  ): Promise<CreatedBooking> {
    if (this.vanishingListing) {
      return Promise.reject(new ListingNotFoundError(booking.listingId));
    }

    if (this.vanishingGuest) {
      return Promise.reject(new GuestNotFoundError(guestId));
    }

    if (this.listingOwnerId === guestId) {
      return Promise.reject(new OwnListingError(booking.listingId));
    }

    // Released before the overlap check, as the transaction does; a refusal below would
    // roll that back with it, which this fake does not model — no spec refuses after one.
    const released = this.release(
      (found) => found.booking.listingId === booking.listingId,
    );

    const overlaps = this.allBookings()
      .filter(isActive)
      .some(
        (stay) =>
          stay.listingId === booking.listingId &&
          stay.from < booking.to &&
          stay.to > booking.from,
      );

    if (overlaps) {
      return Promise.reject(new DatesUnavailableError(booking));
    }

    const stored: Booking = {
      // A uuid and a distinct moment, because the cursor the service issues off the last
      // row of a page is parsed back as untrusted input: `booking-2` is not an id the
      // contract's `uuid()` reads, and rows sharing one `createdAt` would leave the
      // ordering to the tiebreaker alone.
      id: randomUUID(),
      listingId: booking.listingId,
      listing,
      guestId,
      from: booking.from,
      to: booking.to,
      status: BookingStatus.PENDING_PAYMENT,
      amount: AMOUNT,
      refundedAmount: null,
      refundOwed: null,
      paid: false,
      dispute: null,
      expiresAt: holdExpiry(new Date()).toISOString(),
      createdAt: new Date(
        Date.parse("2026-08-17T12:00:00.000Z") + this.rows.size * 1_000,
      ).toISOString(),
      reviewed: { byGuest: false, byOwner: false },
    };

    const created = {
      booking: stored,
      listingOwnerId: this.listingOwnerId,
      paymentId: null,
    };

    this.rows.set(stored.id, created);

    return Promise.resolve({ ...created, released });
  }

  async cancel(
    id: string,
    status: BookingStatus,
    refundOwed: number | null,
  ): Promise<CancelledStay | null> {
    await this.racing?.(id);

    const found = this.rows.get(id);

    if (
      found === undefined ||
      !isActive(found.booking) ||
      found.booking.status !== status
    ) {
      return null;
    }

    found.booking.status = BookingStatus.CANCELLED;
    found.booking.refundOwed = refundOwed;

    return { paymentId: found.paymentId };
  }

  /** The failed runs of an owed refund by booking, and whether it was set aside. */
  readonly refundFailures = new Map<
    string,
    { attempts: number; setAside: boolean }
  >();

  /** The fewest failures first, leaving out what was set aside or waits on a dispute. */
  findOwedRefunds(limit: number): Promise<string[]> {
    const attemptsOf = (id: string) =>
      this.refundFailures.get(id)?.attempts ?? 0;

    return Promise.resolve(
      this.allBookings()
        .filter(
          (booking) =>
            booking.refundOwed !== null &&
            booking.dispute !== "OPEN" &&
            this.refundFailures.get(booking.id)?.setAside !== true,
        )
        .map((booking) => booking.id)
        .sort((left, right) => attemptsOf(left) - attemptsOf(right))
        .slice(0, limit),
    );
  }

  recordRefundFailure(
    id: string,
    _error: string,
    maxAttempts: number,
  ): Promise<SetAside | null> {
    const failure = this.refundFailures.get(id) ?? {
      attempts: 0,
      setAside: false,
    };

    if (this.rows.get(id)?.booking.refundOwed == null || failure.setAside) {
      return Promise.resolve(null);
    }

    failure.attempts += 1;
    failure.setAside = failure.attempts >= maxAttempts;
    this.refundFailures.set(id, failure);

    return Promise.resolve({ ...failure });
  }

  /** The total only upwards, and the debt cleared with it. */
  settleOwedRefund(id: string, total: number | null): Promise<void> {
    const found = this.rows.get(id);

    if (found === undefined) return Promise.resolve();

    if (total !== null && (found.booking.refundedAmount ?? 0) < total) {
      found.booking.refundedAmount = total;
    }

    found.booking.refundOwed = null;
    this.refundFailures.delete(id);

    return Promise.resolve();
  }

  /** One holder per booking at a time, the rest queued behind it as the lease makes them. */
  private readonly cancelling = new Map<string, Promise<unknown>>();

  /** The bookings a lease was taken for, in order. */
  readonly leases: string[] = [];

  whileCancelling<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (this.held.has(id)) {
      return Promise.reject(new CancellationInProgressError(id));
    }

    this.leases.push(id);

    const previous = this.cancelling.get(id) ?? Promise.resolve();
    const next = previous.then(work, work);

    this.cancelling.set(
      id,
      next.catch(() => undefined),
    );

    return next;
  }

  async attachPayment(id: string, paymentId: string): Promise<boolean> {
    await this.racing?.(id);

    const found = this.rows.get(id);

    if (
      found?.booking.status !== BookingStatus.PENDING_PAYMENT ||
      (found.paymentId !== null && found.paymentId !== paymentId)
    ) {
      return false;
    }

    found.paymentId = paymentId;

    return true;
  }

  confirmPayment(
    id: string,
    paymentId: string,
    _chargeId: string | null,
    amount: number,
  ): Promise<ConfirmedStay | null> {
    const found = this.rows.get(id);

    if (
      found?.booking.status !== BookingStatus.PENDING_PAYMENT ||
      found.booking.amount !== amount ||
      (found.paymentId !== null && found.paymentId !== paymentId)
    ) {
      return Promise.resolve(null);
    }

    found.booking.status = BookingStatus.CONFIRMED;
    found.paymentId = paymentId;
    found.booking.paid = true;

    return Promise.resolve(holdOf(found));
  }

  /** The stays whose confirmation both sides were told of. */
  private readonly announced = new Set<string>();

  markConfirmationAnnounced(id: string): Promise<void> {
    this.announced.add(id);

    return Promise.resolve();
  }

  findPaymentTarget(id: string): Promise<RefundTarget | null> {
    const found = this.rows.get(id);

    return Promise.resolve(
      found === undefined ? null : this.refundTargetOf(found),
    );
  }

  findRefundTarget(paymentId: string): Promise<RefundTarget | null> {
    const found = [...this.rows.values()].find(
      (row) => row.paymentId === paymentId,
    );

    return Promise.resolve(
      found === undefined ? null : this.refundTargetOf(found),
    );
  }

  private refundTargetOf(found: BookingWithListingOwner): RefundTarget {
    return {
      bookingId: found.booking.id,
      status: found.booking.status,
      amount: found.booking.amount,
      refundedAmount: found.booking.refundedAmount,
      refundOwed: found.booking.refundOwed,
      paid: found.booking.paid,
      confirmationAnnounced: this.announced.has(found.booking.id),
      hold: holdOf(found),
    };
  }

  /** Only upwards and only for a paid stay, from exactly what the caller read. */
  raiseRefunded(id: string, from: number | null, to: number): Promise<boolean> {
    const found = this.rows.get(id);

    if (
      found === undefined ||
      !found.booking.paid ||
      found.booking.refundedAmount !== from
    ) {
      return Promise.resolve(false);
    }

    found.booking.refundedAmount = to;

    return Promise.resolve(true);
  }

  recordRefund(id: string, amount: number): Promise<boolean> {
    const found = this.rows.get(id);

    if (found === undefined || found.booking.refundedAmount !== null) {
      return Promise.resolve(false);
    }

    found.booking.refundedAmount = amount;

    return Promise.resolve(true);
  }

  expireHold(id: string): Promise<ReleasedHold[]> {
    return Promise.resolve(this.release((found) => found.booking.id === id));
  }

  expireLapsedHolds(): Promise<ReleasedHold[]> {
    return Promise.resolve(this.release(() => true));
  }

  /** The lapsed, still pending holds among those `which` picks, flipped to `EXPIRED`. */
  private release(
    which: (found: BookingWithListingOwner) => boolean,
  ): ReleasedHold[] {
    return [...this.rows.values()]
      .filter(
        (found) =>
          which(found) &&
          this.lapsed.has(found.booking.id) &&
          found.booking.status === BookingStatus.PENDING_PAYMENT,
      )
      .map((found) => {
        found.booking.status = BookingStatus.EXPIRED;

        return holdOf(found);
      });
  }

  /** Read by `ListingService`, never by this one — see `listing.service.spec.ts`. */
  findActiveRanges(
    listingId: string,
    window: { from: string; to: string },
  ): Promise<BookedRange[]> {
    return Promise.resolve(
      this.allBookings()
        .filter(
          (stay) =>
            stay.listingId === listingId &&
            isActive(stay) &&
            stay.from < window.to &&
            stay.to > window.from,
        )
        .map((stay) => ({ from: stay.from, to: stay.to })),
    );
  }

  /**
   * The filters, the ordering and the cursor, in memory. They belong to the repository and
   * are exercised against a real database by the e2e specs — what the fake has to get
   * right is the shape the service reasons about: a scope narrowed further by the filters
   * (never widened by them), `limit` rows with `hasMore` beside them, and a page that
   * starts after the row the cursor names.
   */
  private pageOf(
    rows: Booking[],
    query: BookingQuery,
    cursor: BookingCursor | null,
  ): Promise<Page<Booking>> {
    const matching = rows
      .filter(
        (stay) => query.status === undefined || stay.status === query.status,
      )
      .filter(
        (stay) =>
          query.listingId === undefined || stay.listingId === query.listingId,
      )
      .filter(
        (stay) => query.guestId === undefined || stay.guestId === query.guestId,
      )
      .filter(
        (stay) =>
          query.from === undefined ||
          query.to === undefined ||
          (stay.from < query.to && stay.to > query.from),
      )
      .sort(ordering(query.sort));

    const start =
      cursor === null
        ? 0
        : matching.findIndex((stay) => stay.id === cursor.id) + 1;

    return Promise.resolve({
      items: matching.slice(start, start + query.limit),
      hasMore: matching.length > start + query.limit,
    });
  }

  private allBookings(): Booking[] {
    return [...this.rows.values()].map((found) => found.booking);
  }
}

export function holdOf({
  booking,
  listingOwnerId,
  paymentId,
}: BookingWithListingOwner): ReleasedHold {
  return {
    stay: stayNoticeOf(booking),
    guestId: booking.guestId,
    listingOwnerId,
    paymentId,
  };
}

/**
 * The provider, as far as the rules here care: which payments were opened, withdrawn and
 * refunded, under which keys. Refunds are recorded by key the way Stripe treats them — a
 * second call with a key already used is the same refund, not another one.
 */
export class FakePaymentGateway implements PublicOf<PaymentGateway> {
  readonly opened = new Map<string, OpenedPayment>();
  readonly withdrawn: string[] = [];
  readonly refunds = new Map<string, { paymentId: string; amount: number }>();

  /** Set to have every refund fail, as a provider that cannot be reached would. */
  refusing = false;

  /** Set to have a withdrawal fail, as it does for a payment that completed already. */
  refusingWithdrawal = false;

  /** Set to have `open` find another request opening the same payment under its key. */
  openingElsewhere = false;

  open(bookingId: string): Promise<OpenedPayment> {
    if (this.openingElsewhere) {
      return Promise.reject(new PaymentOpeningInProgressError(bookingId));
    }

    const opened = this.opened.get(bookingId) ?? {
      id: `pi_${String(this.opened.size + 1)}`,
      clientSecret: `pi_${String(this.opened.size + 1)}_secret`,
    };

    this.opened.set(bookingId, opened);

    return Promise.resolve(opened);
  }

  cancel(paymentId: string): Promise<void> {
    if (this.refusingWithdrawal) {
      return Promise.reject(new Error("payment_intent_unexpected_state"));
    }

    this.withdrawn.push(paymentId);

    return Promise.resolve();
  }

  refund(paymentId: string, amount: number, key: string): Promise<number> {
    if (this.refusing) return Promise.reject(new Error("api_connection_error"));

    const sent = this.refunds.get(key) ?? { paymentId, amount };

    this.refunds.set(key, sent);

    return Promise.resolve(sent.amount);
  }

  /** Refunds made from the dashboard whose webhook has not arrived yet, by payment. */
  readonly refundedUnreported = new Map<string, number>();

  refundedSoFar(paymentId: string): Promise<number> {
    const issued = [...this.refunds.values()]
      .filter((refund) => refund.paymentId === paymentId)
      .reduce((total, refund) => total + refund.amount, 0);

    return Promise.resolve(
      issued + (this.refundedUnreported.get(paymentId) ?? 0),
    );
  }

  readEvent(): PaymentEvent {
    throw new Error("The webhook controller's to call, not the service's");
  }
}

/**
 * Whoever follows the stays, as far as the booking side cares: the stays it confirmed and
 * the refunds it announced. What a payout side does with them is `payout.service.spec.ts`'s.
 */
export class FakeStayListener implements Required<StayListener> {
  readonly scheduled: string[] = [];

  /** Each refund announced, with the refund total the stay recorded by then. */
  readonly settled: { bookingId: string; refunded: number | null }[] = [];

  constructor(
    private readonly bookingRepository: Pick<
      FakeBookingRepository,
      "findByIdWithListingOwner"
    >,
  ) {}

  /** Set to have taking back a payout fail, as a provider that cannot be reached would. */
  refusing = false;

  /** Set to have the next payout fail to be scheduled, as a Redis that is down would. */
  refusingSchedule = false;

  confirmed(stay: { bookingId: string }): Promise<void> {
    if (this.refusingSchedule) {
      this.refusingSchedule = false;

      return Promise.reject(new Error("connect ECONNREFUSED"));
    }

    this.scheduled.push(stay.bookingId);

    return Promise.resolve();
  }

  async refunded(bookingId: string): Promise<void> {
    if (this.refusing) throw new Error("api_connection_error");

    const found =
      await this.bookingRepository.findByIdWithListingOwner(bookingId);

    this.settled.push({
      bookingId,
      refunded: found?.booking.refundedAmount ?? null,
    });
  }
}

/**
 * `runAt` is taken as an argument rather than ignored, because that is the only thing the
 * service decides about the deadline: it forwards the one the repository wrote. A fake
 * with the shorter signature stays assignable (see `PublicOf` above), so nothing but this
 * would notice a service that scheduled the job for the wrong moment — or for `now`.
 */
export class FakeBookingJobs implements PublicOf<BookingJobs> {
  readonly scheduled: { bookingId: string; runAt: Date }[] = [];
  readonly cancelled: string[] = [];
  /** The payments queued for withdrawal; the job that withdraws them is `withdrawPayment`. */
  readonly withdrawals: string[] = [];

  scheduleExpiry(bookingId: string, runAt: Date): Promise<void> {
    this.scheduled.push({ bookingId, runAt });

    return Promise.resolve();
  }

  cancelExpiry(bookingId: string): Promise<void> {
    this.cancelled.push(bookingId);

    return Promise.resolve();
  }

  withdrawPayment(paymentId: string): Promise<void> {
    this.withdrawals.push(paymentId);

    return Promise.resolve();
  }

  /** The cancellations whose refund was queued. */
  readonly refunds: string[] = [];

  /** What a refund job failed with; the request that queued it never hears of it. */
  readonly failedRefunds: unknown[] = [];

  /**
   * The worker, run at once as if it had picked the job up: most specs are about what a
   * cancellation ends up refunding, not about when. `null` leaves the job waiting.
   */
  worker: ((bookingId: string) => Promise<unknown>) | null = null;

  async refundCancellation(bookingId: string): Promise<void> {
    this.refunds.push(bookingId);

    try {
      await this.worker?.(bookingId);
    } catch (error) {
      this.failedRefunds.push(error);
    }
  }
}

/**
 * `notify` and `notifyAdmins`, the two methods these services call: what is asserted is who
 * was told what, and the storing and pushing behind it are `notification.service.spec.ts`'s.
 */
export class FakeNotificationService implements Pick<
  NotificationService,
  "notify" | "notifyAdmins"
> {
  readonly notices: { userId: string; content: NotificationContent }[] = [];
  readonly toAdmins: NotificationContent[] = [];

  notify(userId: string, content: NotificationContent): Promise<void> {
    this.notices.push({ userId, content });

    return Promise.resolve();
  }

  notifyAdmins(content: NotificationContent): Promise<void> {
    this.toAdmins.push(content);

    return Promise.resolve();
  }
}

/** The failures by refund id, written once each the way the unique key writes them. */
export class FakeRefundFailureRepository implements PublicOf<RefundFailureRepository> {
  readonly failures = new Map<string, RefundFailure>();

  record(failure: RefundFailure): Promise<boolean> {
    if (this.failures.has(failure.refundId)) return Promise.resolve(false);

    this.failures.set(failure.refundId, failure);

    return Promise.resolve(true);
  }
}

/**
 * Only `announceFreed`: what is asserted here is which nights were handed over and when.
 * Who among the waiting is told is `waitlist.service.spec.ts`'s.
 */
export class FakeWaitlistService implements Pick<
  WaitlistService,
  "announceFreed"
> {
  readonly freed: FreedNights[] = [];

  announceFreed(freed: FreedNights[]): Promise<void> {
    this.freed.push(
      ...freed.map(({ listingId, from, to }) => ({ listingId, from, to })),
    );

    return Promise.resolve();
  }
}

/** Today plus `days`, in UTC — the refund and cancellation rules read the real clock. */
export const fromToday = (days: number): string =>
  format(addDays(new Date(), days, IN_UTC), "yyyy-MM-dd");

/** The booking module over the fakes above, as both specs build it before each test. */
export type BookingTestbed = {
  service: BookingService;
  paymentHandler: BookingPaymentHandler;
  bookingRepository: FakeBookingRepository;
  bookingJobs: FakeBookingJobs;
  notificationService: FakeNotificationService;
  refundFailureRepository: FakeRefundFailureRepository;
  waitlistService: FakeWaitlistService;
  paymentGateway: FakePaymentGateway;
  stayListener: FakeStayListener;
};

/** The refund job's worker runs at once, and the stay listener is registered. */
export async function createBookingTestbed(): Promise<BookingTestbed> {
  const bookingRepository = new FakeBookingRepository();
  const bookingJobs = new FakeBookingJobs();
  const notificationService = new FakeNotificationService();
  const refundFailureRepository = new FakeRefundFailureRepository();
  const waitlistService = new FakeWaitlistService();
  const paymentGateway = new FakePaymentGateway();
  const stayListener = new FakeStayListener(bookingRepository);

  const moduleRef = await Test.createTestingModule({
    providers: [
      BookingService,
      { provide: BookingRepository, useValue: bookingRepository },
      {
        provide: RefundFailureRepository,
        useValue: refundFailureRepository,
      },
      { provide: BookingJobs, useValue: bookingJobs },
      { provide: NotificationService, useValue: notificationService },
      { provide: WaitlistService, useValue: waitlistService },
      { provide: PaymentGateway, useValue: paymentGateway },
      BookingPaymentHandler,
      StayLifecycle,
      // The ledger and the dispatching are `payment-event-dispatcher.spec.ts`'s.
      { provide: PaymentEventDispatcher, useValue: { register: () => {} } },
    ],
  }).compile();

  const service = moduleRef.get(BookingService);

  bookingJobs.worker = (bookingId) => service.refundCancellation(bookingId);
  moduleRef.get(StayLifecycle).register(stayListener);

  return {
    service,
    paymentHandler: moduleRef.get(BookingPaymentHandler),
    bookingRepository,
    bookingJobs,
    notificationService,
    refundFailureRepository,
    waitlistService,
    paymentGateway,
    stayListener,
  };
}

/** A stay `guest` has paid for, starting `days` from today, its payment's news handled. */
export async function payForStay(
  {
    service,
    paymentHandler,
  }: Pick<BookingTestbed, "service" | "paymentHandler">,
  days: number,
): Promise<string> {
  const id = (
    await service.create(GUEST_ID, {
      listingId: LISTING_ID,
      from: fromToday(days),
      to: fromToday(days + 3),
    })
  ).id;
  const { clientSecret } = await service.payment(id, guest);

  await paymentHandler.handle({
    kind: "succeeded",
    eventId: `evt_${id}`,
    type: "payment_intent.succeeded",
    paymentId: clientSecret.replace("_secret", ""),
    chargeId: `ch_${id}`,
    bookingId: id,
    amount: AMOUNT,
  });

  return id;
}
