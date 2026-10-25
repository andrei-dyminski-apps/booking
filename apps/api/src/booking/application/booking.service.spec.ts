import { tz } from "@date-fns/tz";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { addDays, format, parseISO } from "date-fns";
import { randomUUID } from "node:crypto";
import {
  bookingQuerySchema,
  BookingStatus,
  NotificationType,
  Role,
  StayParty,
  type BookedRange,
  type Booking,
  type BookingQuery,
  type BookingSort,
  type CreateBookingInput,
  type ListingSummary,
  type NotificationContent,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import type { SetAside } from "../../common/job-failure";
import type { Page } from "../../common/paging";
import { NotificationService } from "../../notification/notification.service";
import { WaitlistService } from "../../waitlist/waitlist.service";
import type { FreedNights } from "../../waitlist/waitlist.types";
import {
  DatesUnavailableError,
  GuestNotFoundError,
  ListingNotFoundError,
  OwnListingError,
} from "../domain/booking.errors";
import type {
  BookingCursor,
  BookingWithListingOwner,
  CancelledStay,
  ConfirmedStay,
  CreatedBooking,
  RefundTarget,
  ReleasedHold,
} from "../domain/booking.types";
import { BookingRepository } from "../infrastructure/booking.repository";
import {
  RefundFailureRepository,
  type RefundFailure,
} from "../infrastructure/refund-failure.repository";
import { PaymentEventDispatcher } from "../../payment/application/payment-event-dispatcher";
import {
  PaymentGateway,
  type OpenedPayment,
  type PaymentEvent,
} from "../../payment/application/ports/payment-gateway";
import { BookingPaymentHandler } from "./booking-payment.handler";
import {
  BookingService,
  MAX_REFUND_ATTEMPTS,
  stayNoticeOf,
} from "./booking.service";
import { BookingJobs } from "./ports/booking-jobs";
import { StayLifecycle, type StayListener } from "./stay-lifecycle";
import { ACTIVE_STATUSES, holdExpiry } from "../domain/booking-status";

const GUEST_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const OWNER_ID = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";
const STRANGER_ID = "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f50";
const LISTING_ID = "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b";
const OTHER_LISTING_ID = "3a4b5c6d-7e8f-4091-8a2b-3c4d5e6f7a8b";

/** What the repository resolves beside every stay; no rule in this service reads it. */
const listing: ListingSummary = {
  title: "Loft above the harbour",
  pricePerNight: 120,
};

const input: CreateBookingInput = {
  listingId: LISTING_ID,
  from: "2026-09-01",
  to: "2026-09-05",
};

/** What every stay the fake takes costs; the quote itself is `quoteStay`'s and the e2e's. */
const AMOUNT = 480;

const IN_UTC = { in: tz("UTC") };

const day = (offset: number): string =>
  format(addDays(parseISO("2026-09-01", IN_UTC), offset), "yyyy-MM-dd");

/**
 * The nth stay of a fixture that needs several: a week apart, so no two of them overlap
 * and the fake refuses none — what these specs are about is the paging and the ordering,
 * not the slot.
 */
const stayAfter = (index: number): CreateBookingInput => ({
  ...input,
  from: day(index * 7),
  to: day(index * 7 + 2),
});

const userWith = (id: string, role: Role): AuthenticatedUser => ({
  id,
  email: "someone@example.com",
  role,
});

const guest = userWith(GUEST_ID, Role.USER);
const owner = userWith(OWNER_ID, Role.USER);
const stranger = userWith(STRANGER_ID, Role.USER);
const admin = userWith(STRANGER_ID, Role.ADMIN);

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
type PublicOf<T> = { [K in keyof T]: T[K] };

/**
 * A query as it reaches the service: parsed by the contract rather than written out, so a
 * spec never states a default the API does not have.
 */
const searchFor = (search: Record<string, string> = {}): BookingQuery =>
  bookingQuerySchema.parse(search);

const compare = (left: string, right: string): number => {
  if (left < right) return -1;

  return left > right ? 1 : 0;
};

/** The four orderings of the contract, with the tiebreaker following the key. */
const ordering =
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

const isActive = (booking: Booking): boolean =>
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
class FakeBookingRepository implements PublicOf<BookingRepository> {
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
      found.booking.amount !== amount
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

function holdOf({
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
class FakePaymentGateway implements PublicOf<PaymentGateway> {
  readonly opened = new Map<string, OpenedPayment>();
  readonly withdrawn: string[] = [];
  readonly refunds = new Map<string, { paymentId: string; amount: number }>();

  /** Set to have every refund fail, as a provider that cannot be reached would. */
  refusing = false;

  /** Set to have a withdrawal fail, as it does for a payment that completed already. */
  refusingWithdrawal = false;

  open(bookingId: string): Promise<OpenedPayment> {
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
class FakeStayListener implements Required<StayListener> {
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
class FakeBookingJobs implements PublicOf<BookingJobs> {
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
class FakeNotificationService implements Pick<
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
class FakeRefundFailureRepository implements PublicOf<RefundFailureRepository> {
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
class FakeWaitlistService implements Pick<WaitlistService, "announceFreed"> {
  readonly freed: FreedNights[] = [];

  announceFreed(freed: FreedNights[]): Promise<void> {
    this.freed.push(
      ...freed.map(({ listingId, from, to }) => ({ listingId, from, to })),
    );

    return Promise.resolve();
  }
}

describe("BookingService", () => {
  let service: BookingService;
  let bookingRepository: FakeBookingRepository;
  let bookingJobs: FakeBookingJobs;
  let notificationService: FakeNotificationService;
  let refundFailureRepository: FakeRefundFailureRepository;
  let waitlistService: FakeWaitlistService;
  let paymentGateway: FakePaymentGateway;
  let stayListener: FakeStayListener;
  let paymentHandler: BookingPaymentHandler;

  /** A booking `guest` took against a listing `owner` owns — the row every rule acts on. */
  const bookedByGuest = async (): Promise<string> =>
    (await service.create(GUEST_ID, input)).id;

  /** The notices of one type, in the order they were written. */
  const noticesOf = (type: NotificationType) =>
    notificationService.notices.filter(({ content }) => content.type === type);

  /** The stays one caller is handed, with a search of their own where one matters. */
  const seenBy = async (
    user: AuthenticatedUser,
    search: Record<string, string> = {},
  ): Promise<Booking[]> =>
    (await service.findPage(user, searchFor(search))).items;

  beforeEach(async () => {
    bookingRepository = new FakeBookingRepository();
    bookingJobs = new FakeBookingJobs();
    notificationService = new FakeNotificationService();
    refundFailureRepository = new FakeRefundFailureRepository();
    waitlistService = new FakeWaitlistService();
    paymentGateway = new FakePaymentGateway();
    stayListener = new FakeStayListener(bookingRepository);

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

    service = moduleRef.get(BookingService);
    bookingJobs.worker = (bookingId) => service.refundCancellation(bookingId);
    paymentHandler = moduleRef.get(BookingPaymentHandler);
    moduleRef.get(StayLifecycle).register(stayListener);
  });

  it("stores the booking as a hold in the name of the signed-in guest", async () => {
    const booking = await service.create(GUEST_ID, input);

    expect(booking).toMatchObject({
      ...input,
      guestId: GUEST_ID,
      status: BookingStatus.PENDING_PAYMENT,
    });
    expect(booking.expiresAt).not.toBeNull();
  });

  it("schedules the hold's expiry for the deadline the row carries", async () => {
    const booking = await service.create(GUEST_ID, input);

    expect(bookingJobs.scheduled).toEqual([
      { bookingId: booking.id, runAt: new Date(String(booking.expiresAt)) },
    ]);
  });

  it("answers 404, not 500, when the listing is deleted just before the insert", async () => {
    bookingRepository.vanishingListing = true;

    await expect(service.create(GUEST_ID, input)).rejects.toThrow(
      NotFoundException,
    );
  });

  // The token names the guest and JwtStrategy reads no database, so nothing checks that row
  // before the insert. A gone account is an ended session — the 401 of `/auth/me` — and not
  // a 404 about a listing that is sitting there unbooked.
  it("answers 401 when the account behind the token is gone", async () => {
    bookingRepository.vanishingGuest = true;

    await expect(service.create(GUEST_ID, input)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("answers 403 to a host booking their own listing, and stores nothing", async () => {
    bookingRepository.listingOwnerId = GUEST_ID;

    await expect(service.create(GUEST_ID, input)).rejects.toThrow(
      ForbiddenException,
    );
    expect(bookingRepository.rows.size).toBe(0);
    expect(bookingJobs.scheduled).toEqual([]);
    expect(notificationService.notices).toEqual([]);
  });

  it("turns an overlap raised by the repository into a 409", async () => {
    await bookedByGuest();

    await expect(
      service.create(STRANGER_ID, { ...input, from: "2026-09-04" }),
    ).rejects.toThrow(ConflictException);
    expect(bookingRepository.rows.size).toBe(1);
  });

  it("narrows the list to what the role of the caller may see", async () => {
    await bookedByGuest();
    bookingRepository.listingOwnerId = GUEST_ID;
    await service.create(STRANGER_ID, {
      ...input,
      listingId: OTHER_LISTING_ID,
    });

    await expect(seenBy(guest)).resolves.toHaveLength(1);
    await expect(seenBy(owner, { side: StayParty.HOST })).resolves.toHaveLength(
      1,
    );
    await expect(seenBy(admin)).resolves.toHaveLength(2);
  });

  /**
   * An account is both sides of its stays at once, so `side` picks which half of them a
   * list is — and nothing else: either half is still the caller's own, and an admin's
   * scope has no halves.
   */
  it("hands an account that also hosts the side of its stays it asks for", async () => {
    const trip = await bookedByGuest();
    bookingRepository.listingOwnerId = GUEST_ID;
    const hosted = await service.create(STRANGER_ID, {
      ...input,
      listingId: OTHER_LISTING_ID,
    });

    const ids = async (
      user: AuthenticatedUser,
      side: StayParty,
    ): Promise<string[]> =>
      (await seenBy(user, { side })).map((booking) => booking.id);

    await expect(ids(guest, StayParty.GUEST)).resolves.toEqual([trip]);
    await expect(ids(guest, StayParty.HOST)).resolves.toEqual([hosted.id]);
    await expect(ids(admin, StayParty.GUEST)).resolves.toHaveLength(2);
  });

  /**
   * The filters narrow the scope the role gives and can never widen it, which is the whole
   * reason `guestId` is allowed to be one at all: for a guest it can only ever name
   * themselves, and naming somebody else answers with the empty list it truthfully is
   * rather than with that person's stays.
   */
  it("filters inside the scope of the caller, never around it", async () => {
    await bookedByGuest();
    await service.create(STRANGER_ID, {
      ...input,
      listingId: OTHER_LISTING_ID,
    });

    await expect(seenBy(guest, { guestId: STRANGER_ID })).resolves.toEqual([]);
    await expect(seenBy(admin, { guestId: STRANGER_ID })).resolves.toHaveLength(
      1,
    );
    await expect(
      seenBy(admin, { listingId: OTHER_LISTING_ID }),
    ).resolves.toHaveLength(1);
    await expect(
      seenBy(admin, { status: BookingStatus.CANCELLED }),
    ).resolves.toEqual([]);
  });

  /**
   * A page carries a cursor only while there is another one behind it, and the next page
   * starts after the row that cursor names — no row twice and none skipped, which is what
   * a keyset page buys over an offset a new booking would shift.
   */
  it("cuts the list into pages and issues a cursor only while there is one after", async () => {
    for (let taken = 0; taken < 3; taken += 1) {
      await service.create(GUEST_ID, stayAfter(taken));
    }

    const first = await service.findPage(guest, searchFor({ limit: "2" }));

    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.findPage(
      guest,
      searchFor({ limit: "2", cursor: String(first.nextCursor) }),
    );

    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.items.map((stay) => stay.id)).not.toContain(
      first.items[0]?.id,
    );
  });

  /**
   * A cursor names a place in one ordering and in no other: read under another it would
   * compare a check-in against a moment, and the rows after it would be a page of neither
   * list. Both refusals are the client's to act on — dropping the cursor starts the pages
   * again, which is exactly what changing the ordering means.
   */
  it("refuses a cursor from another ordering, and one it never issued", async () => {
    await bookedByGuest();
    await service.create(GUEST_ID, stayAfter(1));

    const page = await service.findPage(guest, searchFor({ limit: "1" }));
    const cursor = String(page.nextCursor);

    await expect(
      service.findPage(
        guest,
        searchFor({ limit: "1", cursor, sort: "oldest" }),
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.findPage(guest, searchFor({ cursor: "not-a-cursor" })),
    ).rejects.toThrow(BadRequestException);
  });

  it("orders by what was asked for, not by what was stored", async () => {
    const second = await service.create(GUEST_ID, stayAfter(2));
    const first = await service.create(GUEST_ID, stayAfter(0));

    await expect(
      seenBy(guest, { sort: "checkInAsc" }).then((stays) =>
        stays.map((stay) => stay.id),
      ),
    ).resolves.toEqual([first.id, second.id]);

    // `newest` is the default, and it is the moment the stay was taken rather than the
    // day it starts: the later booking of the earlier stay comes first.
    await expect(
      seenBy(guest).then((stays) => stays.map((stay) => stay.id)),
    ).resolves.toEqual([first.id, second.id]);

    await expect(
      seenBy(guest, { sort: "oldest" }).then((stays) =>
        stays.map((stay) => stay.id),
      ),
    ).resolves.toEqual([second.id, first.id]);
  });

  it("shows a booking to its guest, to the owner of the listing and to an admin", async () => {
    const id = await bookedByGuest();

    for (const user of [guest, owner, admin]) {
      await expect(service.findOne(id, user)).resolves.toMatchObject({ id });
    }
  });

  // 404 rather than 403: nothing lets a stranger list bookings, so a 403 would be the one
  // way to learn that an id exists. Cancelling is the other rule and answers differently.
  it("hides it from everyone else, as if it were not there", async () => {
    const id = await bookedByGuest();

    await expect(service.findOne(id, stranger)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.remove(id, stranger)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.findOne(id, guest)).resolves.toMatchObject({ id });
  });

  it("lets the guest and an admin cancel, and the owner of the listing only look", async () => {
    const id = await bookedByGuest();

    // Reading the bookings against your listing is not the same right as cancelling one.
    await expect(service.remove(id, owner)).rejects.toThrow(ForbiddenException);
    await expect(service.findOne(id, owner)).resolves.toMatchObject({ id });

    await service.remove(id, guest);
    expect(bookingJobs.cancelled).toContain(id);

    const second = await bookedByGuest();
    await service.remove(second, admin);

    await expect(seenBy(admin)).resolves.toHaveLength(2);
  });

  // The lease would otherwise let anybody who knows an id keep the guest's own
  // cancellation and the refund's webhook waiting behind refused requests.
  it("takes the cancellation lease only for somebody who may cancel", async () => {
    const id = await bookedByGuest();

    await expect(service.remove(id, owner)).rejects.toThrow(ForbiddenException);
    await expect(service.remove(id, stranger)).rejects.toThrow(
      NotFoundException,
    );
    expect(bookingRepository.leases).toEqual([]);

    await service.remove(id, guest);
    expect(bookingRepository.leases).toEqual([id]);
  });

  it("tells the host about a hold the moment it is taken", async () => {
    const booking = await service.create(GUEST_ID, input);

    expect(notificationService.notices).toEqual([
      {
        userId: OWNER_ID,
        content: {
          type: NotificationType.BOOKING_REQUESTED,
          data: {
            bookingId: booking.id,
            listingId: LISTING_ID,
            listingTitle: listing.title,
            from: input.from,
            to: input.to,
          },
        },
      },
    ]);
  });

  it("tells the host when the guest cancels, and both sides when an admin does", async () => {
    const recipientsOfCancelling = async (
      canceller: AuthenticatedUser,
    ): Promise<{ userId: string; recipient: string }[]> => {
      const id = await bookedByGuest();

      notificationService.notices.length = 0;
      await service.remove(id, canceller);

      return notificationService.notices.map(({ userId, content }) => {
        if (content.type !== NotificationType.BOOKING_CANCELLED) {
          throw new Error(`Unexpected ${content.type}`);
        }

        return { userId, recipient: content.data.recipient };
      });
    };

    await expect(recipientsOfCancelling(guest)).resolves.toEqual([
      { userId: OWNER_ID, recipient: StayParty.HOST },
    ]);
    await expect(recipientsOfCancelling(admin)).resolves.toEqual([
      { userId: GUEST_ID, recipient: StayParty.GUEST },
      { userId: OWNER_ID, recipient: StayParty.HOST },
    ]);
  });

  describe("the waitlist", () => {
    const nights = { listingId: LISTING_ID, from: input.from, to: input.to };

    it("hands it the nights a cancellation let go of", async () => {
      const id = await bookedByGuest();

      await service.remove(id, guest);

      expect(waitlistService.freed).toEqual([nights]);
    });

    it("hands it nothing for a cancellation it refused", async () => {
      const id = await bookedByGuest();

      await expect(service.remove(id, owner)).rejects.toThrow(
        ForbiddenException,
      );

      expect(waitlistService.freed).toEqual([]);
    });

    it("hands it the nights of a lapsed hold, on every path that releases one", async () => {
      const byJob = await bookedByGuest();

      bookingRepository.lapsed.add(byJob);
      await service.releaseHold(byJob);
      expect(waitlistService.freed).toEqual([nights]);

      bookingRepository.lapsed.add(await bookedByGuest());
      await service.releaseLapsedHolds();
      expect(waitlistService.freed).toEqual([nights, nights]);

      bookingRepository.lapsed.add(await bookedByGuest());
      await service.create(GUEST_ID, input);
      expect(waitlistService.freed).toEqual([nights, nights, nights]);
    });

    it("hands it nothing when nothing was released", async () => {
      await bookedByGuest();
      await service.releaseLapsedHolds();

      expect(waitlistService.freed).toEqual([]);
    });
  });

  describe("a lapsed hold", () => {
    /** Who heard about an expiry, and as which side of the stay. */
    const expiryNotices = (): { userId: string; recipient: string }[] =>
      notificationService.notices.flatMap(({ userId, content }) =>
        content.type === NotificationType.BOOKING_EXPIRED
          ? [{ userId, recipient: content.data.recipient }]
          : [],
      );

    const lapsedHold = async (): Promise<string> => {
      const id = await bookedByGuest();

      bookingRepository.lapsed.add(id);
      notificationService.notices.length = 0;

      return id;
    };

    const bothSides = [
      { userId: GUEST_ID, recipient: StayParty.GUEST },
      { userId: OWNER_ID, recipient: StayParty.HOST },
    ];

    it("tells both sides when its own job releases it", async () => {
      const id = await lapsedHold();

      await service.releaseHold(id);

      expect(expiryNotices()).toEqual(bothSides);
      expect(notificationService.notices[0]?.content.data).toMatchObject({
        bookingId: id,
        listingId: LISTING_ID,
        listingTitle: listing.title,
        from: input.from,
        to: input.to,
      });
    });

    it("tells both sides when the sweep releases it, and counts it", async () => {
      await lapsedHold();

      await expect(service.releaseLapsedHolds()).resolves.toBe(1);
      expect(expiryNotices()).toEqual(bothSides);
    });

    it("tells both sides when a booking of the same listing releases it", async () => {
      await lapsedHold();

      await service.create(GUEST_ID, input);

      expect(expiryNotices()).toEqual(bothSides);
      // The release happened first, so the host reads it before the request that followed.
      expect(
        notificationService.notices
          .filter(({ userId }) => userId === OWNER_ID)
          .map(({ content }) => content.type),
      ).toEqual([
        NotificationType.BOOKING_EXPIRED,
        NotificationType.BOOKING_REQUESTED,
      ]);
    });

    it("tells nobody when the job lands on a hold no longer pending", async () => {
      const id = await lapsedHold();

      await service.remove(id, guest);
      notificationService.notices.length = 0;

      await service.releaseHold(id);
      await expect(service.releaseLapsedHolds()).resolves.toBe(0);
      expect(notificationService.notices).toEqual([]);
    });

    it("tells nobody twice when the job and the sweep both reach it", async () => {
      const id = await lapsedHold();

      await service.releaseHold(id);
      await service.releaseLapsedHolds();

      expect(expiryNotices()).toEqual(bothSides);
    });
  });

  it("tells nobody about a cancellation it refused", async () => {
    const id = await bookedByGuest();

    notificationService.notices.length = 0;
    await expect(service.remove(id, owner)).rejects.toThrow(ForbiddenException);

    expect(notificationService.notices).toEqual([]);
  });

  /**
   * A cancelled stay is a record, not a deletion — phase 6 refunds against it. So it keeps
   * answering its guest, with the status saying what happened and the deadline the hold
   * had still on it, and only a second cancellation is refused.
   */
  it("keeps the cancelled booking readable, and refuses to cancel it twice", async () => {
    const id = await bookedByGuest();
    const held = await service.findOne(id, guest);

    await service.remove(id, guest);

    await expect(service.findOne(id, guest)).resolves.toMatchObject({
      id,
      status: BookingStatus.CANCELLED,
      expiresAt: held.expiresAt,
    });
    await expect(service.remove(id, guest)).rejects.toThrow(NotFoundException);
  });

  it("throws NotFoundException for an unknown id", async () => {
    await expect(service.findOne(LISTING_ID, admin)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.remove(LISTING_ID, admin)).rejects.toThrow(
      NotFoundException,
    );
  });

  /**
   * The cast is the point of the test: the type says this cannot happen, and the runtime
   * is where it can — the role arrives in a signed token that JwtStrategy does not parse,
   * so one minted before a role was renamed still carries the old name. A role that fell
   * through the switch would reach no query at all, which is why it has to say so.
   */
  it("fails closed on a role no branch of the scope names", async () => {
    await bookedByGuest();

    const stale = userWith(STRANGER_ID, "MODERATOR" as unknown as Role);

    await expect(service.findPage(stale, searchFor())).rejects.toThrow(
      ForbiddenException,
    );
  });
  describe("the payment", () => {
    it("opens one payment per hold and answers the same one again", async () => {
      const id = await bookedByGuest();

      const first = await service.payment(id, guest);
      const second = await service.payment(id, guest);

      expect(first).toEqual({
        clientSecret: "pi_1_secret",
        amount: AMOUNT,
        currency: "eur",
      });
      expect(second).toEqual(first);
      expect(bookingRepository.rows.get(id)?.paymentId).toBe("pi_1");
    });

    it("answers the guest alone, and hides the stay from a stranger", async () => {
      const id = await bookedByGuest();

      // The host and an admin may read the stay; paying for it is not theirs.
      await expect(service.payment(id, owner)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.payment(id, admin)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.payment(id, stranger)).rejects.toThrow(
        NotFoundException,
      );
      expect(paymentGateway.opened.size).toBe(0);
    });

    it("refuses a booking that no longer waits for payment", async () => {
      const cancelled = await bookedByGuest();
      await service.remove(cancelled, guest);

      await expect(service.payment(cancelled, guest)).rejects.toThrow(
        ConflictException,
      );

      // Past its deadline but not released yet: the sweep is about to give the nights away.
      const lapsing = (await service.create(GUEST_ID, stayAfter(1))).id;
      const found = bookingRepository.rows.get(lapsing);

      if (found === undefined) throw new Error("The hold was not stored");

      found.booking.expiresAt = new Date(Date.now() - 1_000).toISOString();

      await expect(service.payment(lapsing, guest)).rejects.toThrow(
        ConflictException,
      );
      expect(paymentGateway.opened.size).toBe(0);
    });

    it("withdraws a payment opened while the hold was being released", async () => {
      const id = await bookedByGuest();
      bookingRepository.lapsed.add(id);
      bookingRepository.racing = () => service.releaseHold(id);

      await expect(service.payment(id, guest)).rejects.toThrow(
        ConflictException,
      );
      expect(bookingRepository.rows.get(id)?.paymentId).toBeNull();
      expect(bookingJobs.withdrawals).toEqual(["pi_1"]);
    });
  });

  describe("the payment of a hold", () => {
    const succeeded = (
      bookingId: string | null,
      paymentId = "pi_1",
      eventId = "evt_1",
    ): PaymentEvent => ({
      kind: "succeeded",
      eventId,
      type: "payment_intent.succeeded",
      paymentId,
      chargeId: `ch_${paymentId}`,
      bookingId,
      amount: AMOUNT,
    });

    it("confirms the hold its payment names, and tells both sides", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await paymentHandler.handle(succeeded(id));

      expect(bookingRepository.rows.get(id)?.booking.status).toBe(
        BookingStatus.CONFIRMED,
      );
      expect(
        noticesOf(NotificationType.BOOKING_CONFIRMED).map(
          ({ userId }) => userId,
        ),
      ).toEqual([GUEST_ID, OWNER_ID]);
    });

    it("announces the stay it confirms to whoever follows the stays", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await paymentHandler.handle(succeeded(id));

      expect(stayListener.scheduled).toEqual([id]);
    });

    it("finishes what an earlier delivery of the same payment left undone, and refunds nothing", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      stayListener.refusingSchedule = true;

      // The first delivery dies after the confirmation committed and before anybody heard.
      await expect(paymentHandler.handle(succeeded(id))).rejects.toThrow();

      // The same news again, which the ledger never recorded. The state tells it apart
      // from a late payment.
      await paymentHandler.handle(succeeded(id, "pi_1", "evt_2"));

      expect(
        noticesOf(NotificationType.BOOKING_CONFIRMED).map(
          ({ userId }) => userId,
        ),
      ).toEqual([GUEST_ID, OWNER_ID]);
      expect(stayListener.scheduled).toEqual([id]);
      expect(paymentGateway.refunds.size).toBe(0);
    });

    it("tells nobody again when a delivery that finished comes once more", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      await paymentHandler.handle(succeeded(id));

      await paymentHandler.handle(succeeded(id, "pi_1", "evt_2"));

      expect(noticesOf(NotificationType.BOOKING_CONFIRMED)).toHaveLength(2);
      expect(stayListener.scheduled).toEqual([id]);
    });

    it("tells both sides once when two deliveries of one payment race", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await Promise.all([
        paymentHandler.handle(succeeded(id)),
        paymentHandler.handle(succeeded(id)),
      ]);

      expect(
        noticesOf(NotificationType.BOOKING_CONFIRMED).map(
          ({ userId }) => userId,
        ),
      ).toEqual([GUEST_ID, OWNER_ID]);
      expect(stayListener.scheduled).toEqual([id]);
    });

    it("confirms nothing with a payment of another sum, and gives it back", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await paymentHandler.handle({
        kind: "succeeded",
        eventId: "evt_1",
        type: "payment_intent.succeeded",
        paymentId: "pi_1",
        chargeId: "ch_pi_1",
        bookingId: id,
        amount: AMOUNT - 1,
      });

      expect(bookingRepository.rows.get(id)?.booking.status).toBe(
        BookingStatus.PENDING_PAYMENT,
      );
      expect([...paymentGateway.refunds.values()]).toEqual([
        { paymentId: "pi_1", amount: AMOUNT - 1 },
      ]);
    });

    it("gives back a payment that arrives for a hold no longer holding its nights", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      bookingRepository.lapsed.add(id);
      await service.releaseHold(id);

      await paymentHandler.handle(succeeded(id));

      const found = bookingRepository.rows.get(id);
      expect(found?.booking.status).toBe(BookingStatus.EXPIRED);
      expect(found?.booking.refundedAmount).toBe(AMOUNT);
      expect([...paymentGateway.refunds.values()]).toEqual([
        { paymentId: "pi_1", amount: AMOUNT },
      ]);
      const refunded = noticesOf(NotificationType.PAYMENT_REFUNDED);
      expect(refunded.map(({ userId }) => userId)).toEqual([GUEST_ID]);
      expect(refunded[0]?.content.data).toMatchObject({
        bookingId: id,
        amount: AMOUNT,
      });
    });

    it("throws when its refund fails, so the delivery comes again and finishes", async () => {
      const id = await bookedByGuest();
      await service.remove(id, guest);
      paymentGateway.refusing = true;

      await expect(paymentHandler.handle(succeeded(id))).rejects.toThrow();

      paymentGateway.refusing = false;
      await paymentHandler.handle(succeeded(id));

      expect(paymentGateway.refunds.size).toBe(1);
    });

    it("tells the guest about a late payment's refund once, however often it arrives", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      await service.remove(id, guest);

      await paymentHandler.handle(succeeded(id));
      // The same news under another event id, which the ledger has not seen.
      await paymentHandler.handle(succeeded(id, "pi_1", "evt_2"));

      expect(paymentGateway.refunds.size).toBe(1);
      expect(noticesOf(NotificationType.PAYMENT_REFUNDED)).toHaveLength(1);
    });

    it("records a payment that names no booking and touches nothing", async () => {
      await paymentHandler.handle(succeeded(null));

      expect(paymentGateway.refunds.size).toBe(0);
      expect(notificationService.notices).toEqual([]);
    });
  });

  describe("a refund of a paid stay", () => {
    const refunded = (amountRefunded: number): PaymentEvent => ({
      kind: "refunded",
      eventId: `evt_refund_${String(amountRefunded)}`,
      type: "charge.refunded",
      paymentId: "pi_1",
      chargeId: "ch_pi_1",
      amountRefunded,
    });

    /** A confirmed stay, announced to the listener, with nothing else on record yet. */
    const paidHold = async (): Promise<string> => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      await paymentHandler.handle({
        kind: "succeeded",
        eventId: "evt_paid",
        type: "payment_intent.succeeded",
        paymentId: "pi_1",
        chargeId: "ch_pi_1",
        bookingId: id,
        amount: AMOUNT,
      });
      notificationService.notices.length = 0;

      return id;
    };

    it("cancels a stay refunded in full from the dashboard and frees its nights", async () => {
      const id = await paidHold();

      await paymentHandler.handle(refunded(AMOUNT));

      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: AMOUNT,
      });
      expect(
        noticesOf(NotificationType.BOOKING_CANCELLED).map(
          ({ userId }) => userId,
        ),
      ).toEqual([GUEST_ID, OWNER_ID]);
      expect(waitlistService.freed).toEqual([
        { listingId: LISTING_ID, from: input.from, to: input.to },
      ]);
      expect(stayListener.settled).toEqual([
        { bookingId: id, refunded: AMOUNT },
      ]);
    });

    it("keeps a refund the bank sent back on record, owed to the guest, and tells the admins once", async () => {
      const id = await paidHold();
      await paymentHandler.handle(refunded(100));
      notificationService.notices.length = 0;
      stayListener.settled.length = 0;

      const failed: PaymentEvent = {
        kind: "refundFailed",
        eventId: "evt_refund_failed",
        type: "refund.failed",
        paymentId: "pi_1",
        refundId: "re_1",
        amount: 100,
        reason: "expired_or_canceled_card",
      };

      await paymentHandler.handle(failed);
      // A redelivery of the same news.
      await paymentHandler.handle(failed);

      // Neither the guest's claim nor the host's share moves: a person issues it again.
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CONFIRMED,
        refundedAmount: 100,
      });
      expect(notificationService.notices).toEqual([]);
      expect(stayListener.settled).toEqual([]);

      const failure = {
        refundId: "re_1",
        paymentId: "pi_1",
        bookingId: id,
        amount: 100,
        reason: "expired_or_canceled_card",
      };

      expect([...refundFailureRepository.failures.values()]).toEqual([failure]);
      expect(notificationService.toAdmins).toEqual([
        { type: NotificationType.REFUND_FAILED, data: failure },
      ]);
    });

    it("tells the guest about a partial refund from the dashboard, and keeps the stay", async () => {
      const id = await paidHold();

      await paymentHandler.handle(refunded(100));

      expect(bookingRepository.rows.get(id)?.booking.status).toBe(
        BookingStatus.CONFIRMED,
      );
      const refunds = noticesOf(NotificationType.PAYMENT_REFUNDED);

      expect(refunds.map(({ userId }) => userId)).toEqual([GUEST_ID]);
      expect(refunds[0]?.content.data).toMatchObject({ amount: 100 });
    });

    it("tells the guest of two refunds reported at once what each gave back", async () => {
      const id = await paidHold();

      // The lease queues the two, so the second reads what the first wrote.
      await Promise.all([
        paymentHandler.handle(refunded(100)),
        paymentHandler.handle(refunded(150)),
      ]);

      expect(
        noticesOf(NotificationType.PAYMENT_REFUNDED).map(
          ({ content }) => content.data,
        ),
      ).toMatchObject([{ amount: 100 }, { amount: 50 }]);
      expect(bookingRepository.rows.get(id)?.booking.refundedAmount).toBe(150);
    });

    it("lets the payout side settle even a refund it has already seen", async () => {
      const id = await paidHold();

      await paymentHandler.handle(refunded(AMOUNT));
      await paymentHandler.handle(refunded(AMOUNT));

      expect(stayListener.settled).toEqual([
        { bookingId: id, refunded: AMOUNT },
        { bookingId: id, refunded: AMOUNT },
      ]);
      expect(bookingRepository.rows.get(id)?.booking.refundedAmount).toBe(
        AMOUNT,
      );
    });

    it("ignores the refund of a payment that never confirmed a stay", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await paymentHandler.handle(refunded(AMOUNT));

      expect(stayListener.settled).toEqual([]);
      expect(bookingRepository.rows.get(id)?.booking.refundedAmount).toBeNull();
    });
  });

  describe("cancelling", () => {
    /** Today plus `days`, in UTC — the refund rule reads the real clock. */
    const fromToday = (days: number): string =>
      format(addDays(new Date(), days, IN_UTC), "yyyy-MM-dd");

    /** A stay `guest` has paid for, starting `days` from today. */
    const paidStay = async (days: number): Promise<string> => {
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
    };

    it("refunds a guest in full inside the free window, by the job the cancellation queues", async () => {
      const id = await paidStay(30);

      await service.remove(id, guest);

      expect([...paymentGateway.refunds.entries()]).toEqual([
        [`booking-${id}-cancellation`, { paymentId: "pi_1", amount: AMOUNT }],
      ]);
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: AMOUNT,
      });
    });

    it("records the refund an earlier attempt sent rather than sending another", async () => {
      const id = await paidStay(30);
      // Sent by a run whose answer was lost, for less than the stay — the key is what names it.
      paymentGateway.refunds.set(`booking-${id}-cancellation`, {
        paymentId: "pi_1",
        amount: 100,
      });

      await service.remove(id, guest);

      expect(paymentGateway.refunds.size).toBe(1);
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        refundedAmount: 100,
        refundOwed: null,
      });
    });

    it("refunds a guest nothing once the window has closed", async () => {
      const id = await paidStay(1);

      await service.remove(id, guest);

      expect(paymentGateway.refunds.size).toBe(0);
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: null,
      });
    });

    it("refunds only what a dashboard refund left of the payment", async () => {
      const id = await paidStay(30);
      await paymentHandler.handle({
        kind: "refunded",
        eventId: "evt_dashboard",
        type: "charge.refunded",
        paymentId: "pi_1",
        chargeId: "ch_pi_1",
        amountRefunded: 100,
      });

      await service.remove(id, guest);

      expect([...paymentGateway.refunds.values()]).toEqual([
        { paymentId: "pi_1", amount: AMOUNT - 100 },
      ]);
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: AMOUNT,
      });
      expect(stayListener.settled.at(-1)).toEqual({
        bookingId: id,
        refunded: AMOUNT,
      });
    });

    it("refunds only what is left when a dashboard refund has not been reported yet", async () => {
      const id = await paidStay(30);
      paymentGateway.refundedUnreported.set("pi_1", 100);

      await service.remove(id, guest);

      expect([...paymentGateway.refunds.values()]).toEqual([
        { paymentId: "pi_1", amount: AMOUNT - 100 },
      ]);
      // The row counts its own refund only: the dashboard's is its webhook's to tell.
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: AMOUNT - 100,
      });
    });

    it("keeps a dashboard refund on record when the cancellation refunds nothing", async () => {
      const id = await paidStay(1);
      await paymentHandler.handle({
        kind: "refunded",
        eventId: "evt_dashboard",
        type: "charge.refunded",
        paymentId: "pi_1",
        chargeId: "ch_pi_1",
        amountRefunded: 100,
      });

      await service.remove(id, guest);

      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: 100,
      });
    });

    it("refuses to cancel a stay whose payment is disputed until the bank decides", async () => {
      const id = await paidStay(30);
      const found = bookingRepository.rows.get(id);

      if (found !== undefined) found.booking.dispute = "OPEN";

      await expect(service.remove(id, admin)).rejects.toThrow(
        ConflictException,
      );
      expect(paymentGateway.refunds.size).toBe(0);
      expect(found?.booking.status).toBe(BookingStatus.CONFIRMED);
    });

    it("cancels a stay whose dispute was lost without refunding it again", async () => {
      const id = await paidStay(30);
      const found = bookingRepository.rows.get(id);

      if (found !== undefined) found.booking.dispute = "LOST";

      await service.remove(id, admin);

      expect(paymentGateway.refunds.size).toBe(0);
      expect(found?.booking.status).toBe(BookingStatus.CANCELLED);
    });

    const cancellationRefunded: PaymentEvent = {
      kind: "refunded",
      eventId: "evt_cancellation",
      type: "charge.refunded",
      paymentId: "pi_1",
      chargeId: "ch_pi_1",
      amountRefunded: AMOUNT,
    };

    it("reads a cancellation's own refund as no news when its event comes", async () => {
      const id = await paidStay(30);

      await service.remove(id, guest);
      await paymentHandler.handle(cancellationRefunded);

      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: AMOUNT,
        refundOwed: null,
      });
      expect(
        noticesOf(NotificationType.BOOKING_CANCELLED).map(
          ({ userId }) => userId,
        ),
      ).toEqual([OWNER_ID]);
      expect(noticesOf(NotificationType.PAYMENT_REFUNDED)).toEqual([]);
    });

    it("cancels at once and owes the refund until the job sends it", async () => {
      const id = await paidStay(30);
      bookingJobs.worker = null;

      await service.remove(id, guest);

      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: null,
        refundOwed: AMOUNT,
      });
      expect(paymentGateway.refunds.size).toBe(0);
      expect(bookingJobs.refunds).toEqual([id]);
      expect(waitlistService.freed).toHaveLength(1);

      await expect(service.refundCancellation(id)).resolves.toBe(true);
      // A second run — the sweep racing the job — finds nothing owed.
      await expect(service.refundCancellation(id)).resolves.toBe(false);

      expect(paymentGateway.refunds.size).toBe(1);
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        refundedAmount: AMOUNT,
        refundOwed: null,
      });
    });

    it("tells the guest about a dashboard refund of a stay already cancelled", async () => {
      const id = await paidStay(1);
      await service.remove(id, guest);

      await paymentHandler.handle({
        kind: "refunded",
        eventId: "evt_dashboard",
        type: "charge.refunded",
        paymentId: "pi_1",
        chargeId: "ch_pi_1",
        amountRefunded: AMOUNT,
      });

      expect(bookingRepository.rows.get(id)?.booking.refundedAmount).toBe(
        AMOUNT,
      );
      expect(
        noticesOf(NotificationType.PAYMENT_REFUNDED).map(
          ({ userId, content }) => ({ userId, data: content.data }),
        ),
      ).toMatchObject([{ userId: GUEST_ID, data: { amount: AMOUNT } }]);
    });

    const disputeLost: PaymentEvent = {
      kind: "disputeClosed",
      eventId: "evt_dispute_lost",
      type: "charge.dispute.closed",
      paymentId: "pi_1",
      won: false,
    };

    it("cancels a stay not yet begun once its dispute is lost, and frees its nights", async () => {
      const id = await paidStay(30);

      await paymentHandler.handle(disputeLost);

      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundedAmount: null,
      });
      expect(paymentGateway.refunds.size).toBe(0);
      expect(
        noticesOf(NotificationType.BOOKING_CANCELLED).map(
          ({ userId }) => userId,
        ),
      ).toEqual([GUEST_ID, OWNER_ID]);
      expect(waitlistService.freed).toHaveLength(1);
    });

    it("keeps a stay already under way when its dispute is lost, or one whose dispute is won", async () => {
      const begun = await paidStay(0);

      await paymentHandler.handle(disputeLost);
      await paymentHandler.handle({ ...disputeLost, won: true });

      expect(bookingRepository.rows.get(begun)?.booking.status).toBe(
        BookingStatus.CONFIRMED,
      );
      expect(noticesOf(NotificationType.BOOKING_CANCELLED)).toEqual([]);
    });

    it("refunds an admin's cancellation in full after the free window", async () => {
      const id = await paidStay(1);

      await service.remove(id, admin);

      expect(bookingRepository.rows.get(id)?.booking.refundedAmount).toBe(
        AMOUNT,
      );
    });

    it("refuses the guest and an admin alike once the stay has begun", async () => {
      const id = await paidStay(0);

      await expect(service.remove(id, guest)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.remove(id, admin)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(bookingRepository.rows.get(id)?.booking.status).toBe(
        BookingStatus.CONFIRMED,
      );
      expect(paymentGateway.refunds.size).toBe(0);
    });

    it("takes the host's share of a cancellation's refund back once it is sent", async () => {
      const id = await paidStay(1);

      await service.remove(id, admin);

      expect(stayListener.settled).toEqual([
        { bookingId: id, refunded: AMOUNT },
      ]);
    });

    it("settles nothing for a cancellation that refunds nothing", async () => {
      const id = await paidStay(1);

      await service.remove(id, guest);

      expect(stayListener.settled).toEqual([]);
    });

    it("cancels the stay even when the host's payout cannot be taken back yet", async () => {
      const id = await paidStay(1);
      stayListener.refusing = true;

      await service.remove(id, admin);

      expect(bookingRepository.rows.get(id)?.booking.status).toBe(
        BookingStatus.CANCELLED,
      );

      // The refund's own delivery settles it, and comes again until it can.
      await expect(
        paymentHandler.handle(cancellationRefunded),
      ).rejects.toThrow();
      stayListener.refusing = false;
      await paymentHandler.handle(cancellationRefunded);

      expect(stayListener.settled).toEqual([
        { bookingId: id, refunded: AMOUNT },
      ]);
    });

    it("cancels when the refund cannot be issued yet, and the sweep sends it later", async () => {
      const id = await paidStay(30);
      paymentGateway.refusing = true;

      await service.remove(id, guest);

      expect(bookingJobs.failedRefunds).toHaveLength(1);
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundOwed: AMOUNT,
      });

      // Still refused: logged and left for the next minute, not thrown out of the sweep.
      await expect(service.refundOwedCancellations()).resolves.toBe(0);

      paymentGateway.refusing = false;

      await expect(service.refundOwedCancellations()).resolves.toBe(1);
      expect(bookingRepository.rows.get(id)?.booking).toMatchObject({
        refundedAmount: AMOUNT,
        refundOwed: null,
      });
    });

    it("sets a refund Stripe keeps refusing aside and tells the admins", async () => {
      const id = await paidStay(30);
      bookingJobs.worker = null;
      await service.remove(id, guest);
      paymentGateway.refusing = true;

      for (let run = 1; run < MAX_REFUND_ATTEMPTS; run += 1) {
        await expect(service.refundCancellation(id)).rejects.toThrow();
      }

      expect(notificationService.toAdmins).toEqual([]);

      // The last attempt ends the job's retries instead of failing it once more.
      await expect(service.refundCancellation(id)).resolves.toBe(false);
      expect(notificationService.toAdmins).toEqual([
        {
          type: NotificationType.CANCELLATION_REFUND_FAILED,
          data: { bookingId: id, error: expect.any(String) as string },
        },
      ]);
      // Still owed, and left to a person: the sweep no longer reads it.
      expect(bookingRepository.rows.get(id)?.booking.refundOwed).toBe(AMOUNT);
      await expect(bookingRepository.findOwedRefunds(50)).resolves.toEqual([]);
    });

    it("reads the debts that failed least first, so one that keeps failing cannot block the rest", async () => {
      const failing = await paidStay(30);
      bookingJobs.worker = null;
      await service.remove(failing, guest);
      await bookingRepository.recordRefundFailure(failing, "refused", 99);

      const fresh = await paidStay(31);
      await service.remove(fresh, guest);

      await expect(bookingRepository.findOwedRefunds(1)).resolves.toEqual([
        fresh,
      ]);
    });

    it("keeps a refund owed while a dispute opened after the cancellation is open", async () => {
      const id = await paidStay(30);
      bookingJobs.worker = null;
      await service.remove(id, guest);
      const found = bookingRepository.rows.get(id);

      if (found !== undefined) found.booking.dispute = "OPEN";

      await expect(service.refundOwedCancellations()).resolves.toBe(0);
      expect(paymentGateway.refunds.size).toBe(0);
      expect(found?.booking.refundOwed).toBe(AMOUNT);

      // Won: the money is still the platform's, and it goes back as the cancellation said.
      if (found !== undefined) found.booking.dispute = "WON";

      await expect(service.refundOwedCancellations()).resolves.toBe(1);
      expect(found?.booking.refundedAmount).toBe(AMOUNT);
    });

    it("drops a refund owed once a dispute opened after the cancellation is lost", async () => {
      const id = await paidStay(30);
      bookingJobs.worker = null;
      await service.remove(id, guest);
      const found = bookingRepository.rows.get(id);

      if (found !== undefined) found.booking.dispute = "LOST";

      await expect(service.refundOwedCancellations()).resolves.toBe(0);
      expect(paymentGateway.refunds.size).toBe(0);
      expect(found?.booking.refundOwed).toBeNull();
    });

    it("refunds nothing more when a cancelled stay's payment is delivered again", async () => {
      const id = await paidStay(1);
      await service.remove(id, guest);

      // The confirming delivery again, under an id the ledger never recorded.
      await paymentHandler.handle({
        kind: "succeeded",
        eventId: "evt_redelivered",
        type: "payment_intent.succeeded",
        paymentId: "pi_1",
        chargeId: "ch_1",
        bookingId: id,
        amount: AMOUNT,
      });

      expect(paymentGateway.refunds.size).toBe(0);
      expect(noticesOf(NotificationType.PAYMENT_REFUNDED)).toEqual([]);
    });

    it("leaves a hold paid for mid-cancellation confirmed, and asks for another try", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      bookingRepository.racing = async (racedId) => {
        bookingRepository.racing = null;
        await bookingRepository.confirmPayment(racedId, "pi_1", null, AMOUNT);
      };

      await expect(service.remove(id, guest)).rejects.toThrow(
        ConflictException,
      );
      expect(bookingRepository.rows.get(id)?.booking.status).toBe(
        BookingStatus.CONFIRMED,
      );
      expect(bookingJobs.withdrawals).toEqual([]);
    });

    it("withdraws a payment a payment page opened while the hold was being cancelled", async () => {
      const id = await bookedByGuest();
      bookingRepository.racing = async () => {
        bookingRepository.racing = null;
        await service.payment(id, guest);
      };

      await service.remove(id, guest);

      expect(bookingJobs.withdrawals).toEqual(["pi_1"]);
    });

    it("withdraws the payment of a hold instead of refunding it", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);

      await service.remove(id, guest);

      expect(bookingJobs.withdrawals).toEqual(["pi_1"]);
      expect(paymentGateway.refunds.size).toBe(0);
    });
  });

  describe("a lapsed hold's payment", () => {
    it("is queued for withdrawal by whichever path releases the hold", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      bookingRepository.lapsed.add(id);

      await service.releaseLapsedHolds();

      expect(bookingJobs.withdrawals).toEqual(["pi_1"]);
    });

    it("is withdrawn by the job, not by the path that released the hold", async () => {
      const id = await bookedByGuest();
      await service.payment(id, guest);
      bookingRepository.lapsed.add(id);

      await service.releaseHold(id);

      expect(paymentGateway.withdrawn).toEqual([]);

      await service.withdrawPayment("pi_1");

      expect(paymentGateway.withdrawn).toEqual(["pi_1"]);
    });

    it("leaves a withdrawal the provider refuses to the job's next attempt", async () => {
      paymentGateway.refusingWithdrawal = true;

      await expect(service.withdrawPayment("pi_1")).rejects.toThrow();
    });
  });
});
