import { randomUUID } from "node:crypto";
import {
  BookingStatus,
  pricedNights,
  type BookedRange,
  type CancellationPolicy,
  type Booking,
  type BookingQuery,
  type CreateBookingInput,
  type PricedNight,
} from "@repo/contracts";
import type { Page } from "../../../common/paging";
import type { PublicOf } from "../../../common/testing/public-of.fakes";
import {
  cents,
  CURRENCY,
  NO_CENTS,
  type Cents,
} from "../../../payment/domain/money";
import { holdExpiry } from "../../domain/booking-status";
import {
  DatesUnavailableError,
  GuestNotFoundError,
  ListingNotFoundError,
  OwnListingError,
} from "../../domain/booking.errors";
import type {
  BookingCursor,
  BookingDetailWithListingOwner,
  BookingWithListingOwner,
  ConfirmedStay,
  CreatedBooking,
  ReleasedHold,
} from "../../domain/booking.types";
import type { BookingRepository } from "../../infrastructure/booking.repository";
import {
  AMOUNT,
  isActive,
  listing,
  ordering,
  OWNER_ID,
} from "./booking-fixtures.fakes";
import { holdOf, type FakeBookingTable } from "./booking-table.fakes";

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
  constructor(private readonly table: FakeBookingTable) {}

  /** The listing this fake creates bookings against, unless the row says otherwise. */
  listingOwnerId = OWNER_ID;

  /** The listing's policy, which `create` copies onto the stay as the transaction does. */
  listingPolicy: CancellationPolicy = "FLEXIBLE";

  /** The listing's time zone and check-in time, which `create` copies as it copies the policy. */
  listingTimeZone = "UTC";

  listingCheckInTime = "00:00";

  /** Set to have `create` lose the race the pre-flight check cannot close. */
  vanishingListing = false;

  /** Set to have `create` fail on the other key: the account behind the token is gone. */
  vanishingGuest = false;

  /**
   * The holds whose deadline has passed. The fake keeps no clock: a spec names the holds it
   * wants lapsed, and the three expiry paths release exactly those that are still pending.
   */
  readonly lapsed = new Set<string>();

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
      [...this.table.rows.values()]
        .filter((found) => found.listingOwnerId === ownerId)
        .map((found) => found.booking),
      query,
      cursor,
    );
  }

  findByIdWithListingOwner(
    id: string,
  ): Promise<BookingWithListingOwner | null> {
    return Promise.resolve(this.table.rows.get(id) ?? null);
  }

  /**
   * The stay's nights, priced so they add up to what it was charged — `amount_cents = Σ
   * nights` at the standard rate, the invariant the real insert keeps and the early end's
   * refund is measured by. The fake charges every stay `AMOUNT` whatever its length, so its
   * nights share that evenly, the odd cents on the last one, rather than each costing the
   * listing's price: the four of `input` come to 12000 apiece, the three of `payForStay` to
   * 16000.
   */
  findDetailWithListingOwner(
    id: string,
  ): Promise<BookingDetailWithListingOwner | null> {
    const found = this.table.rows.get(id);

    return Promise.resolve(
      found === undefined
        ? null
        : {
            ...found,
            nights: nightsAddingUpTo(found.booking),
            discountCents: NO_CENTS,
          },
    );
  }

  exists(id: string): Promise<boolean> {
    return Promise.resolve(this.table.rows.has(id));
  }

  hasStayedWith(guestId: string, ownerId: string): Promise<boolean> {
    return Promise.resolve(
      [...this.table.rows.values()].some(
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
      hostId: this.listingOwnerId,
      from: booking.from,
      to: booking.to,
      status: BookingStatus.PENDING_PAYMENT,
      amountCents: AMOUNT,
      currency: CURRENCY,
      cancellationPolicy: this.listingPolicy,
      timeZone: this.listingTimeZone,
      checkInTime: this.listingCheckInTime,
      refundedAmountCents: null,
      refundOwedCents: null,
      paid: false,
      dispute: null,
      expiresAt: holdExpiry(new Date()).toISOString(),
      createdAt: new Date(
        Date.parse("2026-08-17T12:00:00.000Z") + this.table.rows.size * 1_000,
      ).toISOString(),
      cancelledBy: null,
      cancelledAt: null,
      cancellationReason: null,
      endedEarlyAt: null,
      reviewed: { byGuest: false, byOwner: false },
    };

    const created = {
      booking: stored,
      listingOwnerId: this.listingOwnerId,
      paymentId: null,
    };

    this.table.rows.set(stored.id, created);

    return Promise.resolve({ ...created, released });
  }

  async attachPayment(id: string, paymentId: string): Promise<boolean> {
    await this.table.racing?.(id);

    const found = this.table.rows.get(id);

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
    amount: Cents,
  ): Promise<ConfirmedStay | null> {
    const found = this.table.rows.get(id);

    if (
      found?.booking.status !== BookingStatus.PENDING_PAYMENT ||
      found.booking.amountCents !== amount ||
      (found.paymentId !== null && found.paymentId !== paymentId)
    ) {
      return Promise.resolve(null);
    }

    found.booking.status = BookingStatus.CONFIRMED;
    found.paymentId = paymentId;
    found.booking.paid = true;

    return Promise.resolve(holdOf(found));
  }

  markConfirmationAnnounced(id: string): Promise<void> {
    this.table.announced.add(id);

    return Promise.resolve();
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
    return [...this.table.rows.values()]
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
    return [...this.table.rows.values()].map((found) => found.booking);
  }
}

/** Every night of the stay, its `amountCents` shared out evenly, the odd cents last. */
function nightsAddingUpTo(
  booking: Pick<Booking, "from" | "to" | "amountCents">,
): PricedNight[] {
  // Only the dates are read off this: the prices are the amount's, shared out below.
  const dates = pricedNights(
    { pricePerNightCents: listing.pricePerNightCents, pricing: NO_EXCEPTIONS },
    booking.from,
    booking.to,
  );
  const each = Math.floor(booking.amountCents / dates.length);
  const odd = booking.amountCents - each * dates.length;

  return dates.map(({ date }, index) => ({
    date,
    priceCents: cents(index === dates.length - 1 ? each + odd : each),
  }));
}

const NO_EXCEPTIONS = { weekdays: {}, dates: [] };
