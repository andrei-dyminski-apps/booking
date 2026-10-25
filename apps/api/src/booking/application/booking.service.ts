import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  BookingStatus,
  DisputeStatus,
  isCancellableOn,
  NotificationType,
  refundOnCancel,
  Role,
  StayParty,
  type Booking,
  type BookingPage,
  type BookingPayment,
  type StayNotice,
  type BookingQuery,
  type CreateBookingInput,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { ownsOrIsAdmin } from "../../auth/ownership";
import { readCursor, type Page } from "../../common/paging";
import { NotificationService } from "../../notification/notification.service";
import { WaitlistService } from "../../waitlist/waitlist.service";
import {
  BookingRepository,
  CancellationInProgressError,
  DatesUnavailableError,
  GuestNotFoundError,
  ListingNotFoundError,
  OwnListingError,
  StayTooCheapError,
  StayTooExpensiveError,
  type BookingWithListingOwner,
  type CancelledStay,
  type CreatedBooking,
  type ReleasedHold,
} from "../infrastructure/booking.repository";
import { PaymentGateway } from "../../payment/application/ports/payment-gateway";
import { toIsoDate } from "../../prisma/iso-date";
import { CURRENCY } from "../../payment/domain/currency";
import { roundCents } from "../../payment/domain/money";
import { isCancellable } from "../domain/booking-status";
import { BookingJobs } from "./ports/booking-jobs";
import { StayLifecycle } from "./stay-lifecycle";
import { notifyBothSides } from "./stay-notices";
import {
  decodeCursor,
  encodeCursor,
  type BookingCursor,
} from "./booking-cursor";

/**
 * The application layer of the booking module: HTTP takes, reads and cancels stays, and the
 * BullMQ jobs release unpaid holds, withdraw their payments and send the refunds
 * cancellations owe. The provider's news reaches the stays through `BookingPaymentHandler`.
 * It sees neither Prisma, Stripe nor BullMQ — the repositories, the `PaymentGateway` port
 * and the `BookingJobs` port — and knows nothing of the host's payout: a refund is
 * announced to `StayLifecycle`.
 */
@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly bookingRepository: BookingRepository,
    private readonly paymentGateway: PaymentGateway,
    private readonly bookingJobs: BookingJobs,
    private readonly notificationService: NotificationService,
    private readonly waitlistService: WaitlistService,
    private readonly stayLifecycle: StayLifecycle,
  ) {}

  /**
   * One page of the stays this caller may see. The filters and the ordering are the
   * client's, the scope is their role's and the cursor is this API's own — an unreadable
   * one is a `400` rather than a silent first page, for the reason `readCursor` states.
   *
   * `nextCursor` is issued from the last row and only when there is another page: one on
   * the last page would invite a request for an empty list.
   */
  async findPage(
    user: AuthenticatedUser,
    query: BookingQuery,
  ): Promise<BookingPage> {
    const cursor = readCursor(query.cursor, query.sort, decodeCursor);
    const { items, hasMore } = await this.pageFor(user, query, cursor);
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last !== undefined ? encodeCursor(last, query.sort) : null,
    };
  }

  /**
   * Not a filter the client may pass, but the scope its role gives it: a user sees the
   * stays they booked or the stays booked against their listings, an admin all of them.
   * A `?guestId=` parameter in its place would leave the same rule to be re-checked
   * on every call — this way the query cannot return a row the caller may not see, and the
   * `guestId` the contract does offer narrows that scope instead of replacing it (the
   * repository `AND`s the two rather than spreading them, which is what makes that true).
   *
   * A role picks one of the named queries rather than assembling a `where`, so there is
   * no shape an unhandled role could fall through to. The switch is exhaustive on purpose
   * — a third role added to the contract stops compiling here — and its `default` assigns
   * the role to `never` and throws, because the type is not the whole guarantee: the role
   * arrives in a signed access token that `JwtStrategy` does not parse against the
   * contract, so one minted before a role was retired still carries the old name for as
   * long as `JWT_ACCESS_TTL`.
   *
   * One account is both sides of its stays — hosting is owning a listing, not a role — so
   * the scope is one of two and the query names which: `side` picks the stays they took or
   * the stays against their listings. It chooses between two scopes of the caller's own and
   * never reaches past them, which is why it may come from the client when the scope as a
   * whole may not.
   */
  private pageFor(
    user: AuthenticatedUser,
    query: BookingQuery,
    cursor: BookingCursor | null,
  ): Promise<Page<Booking>> {
    switch (user.role) {
      case Role.ADMIN:
        return this.bookingRepository.findPageForEveryone(query, cursor);
      case Role.USER:
        return query.side === StayParty.HOST
          ? this.bookingRepository.findPageForListingOwner(
              user.id,
              query,
              cursor,
            )
          : this.bookingRepository.findPageForGuest(user.id, query, cursor);
      default: {
        const unknownRole: never = user.role;

        throw new ForbiddenException(
          `Unknown role ${JSON.stringify(unknownRole)}`,
        );
      }
    }
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<Booking> {
    return (await this.getReadable(id, user)).booking;
  }

  /**
   * The atomicity lives one layer down: `BookingRepository.create` locks the listing row
   * and settles overlaps inside a transaction, and this method only translates the four
   * failures it can raise. On success it schedules the hold's expiry, and that call cannot
   * fail this request: the booking is committed by then, so a Redis that is down would
   * otherwise answer an existing booking with a 500 and never hand the caller its id. The
   * repeatable sweep behind the queue releases a hold whose job never got written.
   *
   * The owner of the listing is told last, and that cannot fail the request either — see
   * `NotificationService.notify`. Just before them, the two sides of any lapsed hold on the
   * same listing the transaction released on the way in are told about it.
   *
   * No payment is opened here: the page that pays asks for it (`payment` below), so a
   * provider that cannot be reached fails a reloadable form rather than the hold.
   */
  async create(guestId: string, input: CreateBookingInput): Promise<Booking> {
    let created: CreatedBooking;

    try {
      created = await this.bookingRepository.create(guestId, input);
    } catch (error) {
      // A hard delete of the listing from outside the API — retiring one leaves the row.
      if (error instanceof ListingNotFoundError) {
        throw new NotFoundException(error.message);
      }

      // A host does not book their own nights — the answer `POST /conversations` gives.
      if (error instanceof OwnListingError) {
        throw new ForbiddenException("You cannot book your own listing");
      }

      // The guest is gone: nothing checks that row beforehand, because the token names it
      // and JwtStrategy reads no database. A signed token whose row is gone is an ended
      // session, so this is the 401 of `/auth/me` and not a 404 about the listing.
      if (error instanceof GuestNotFoundError) {
        throw new UnauthorizedException("Session no longer exists");
      }

      // An overlap with an active stay, caught by the in-transaction check or the
      // EXCLUDE constraint behind it.
      if (error instanceof DatesUnavailableError) {
        throw new ConflictException(error.message);
      }

      // Valid dates on a valid listing that add up to more than a payment can carry.
      if (error instanceof StayTooExpensiveError) {
        throw new UnprocessableEntityException(
          "This stay costs more than one payment can carry — book fewer nights",
        );
      }

      if (error instanceof StayTooCheapError) {
        throw new UnprocessableEntityException(
          "This stay costs less than one payment can carry — book more nights",
        );
      }

      throw error;
    }

    const { booking, listingOwnerId, released } = created;

    if (booking.expiresAt !== null) {
      await this.bookingJobs.scheduleExpiry(
        booking.id,
        new Date(booking.expiresAt),
      );
    }

    // The release came first inside the transaction, so its notices do too: the feed is
    // ordered by when a notice was written, and a host should read that the nights came
    // free before reading who took them.
    await this.notifyExpiry(released);
    await this.withdrawPayments(released);
    await this.notifyOwnerOf(booking, listingOwnerId);
    // After the commit, so the new hold is one of the stays the waitlist checks against:
    // nights it took back are not news to anybody waiting for them.
    await this.waitlistService.announceFreed(released.map(({ stay }) => stay));

    return booking;
  }

  /**
   * The secret of the hold's PaymentIntent, opened on the first request and answered again
   * after it (the gateway names the payment after the booking). Only the guest is answered —
   * `403` to the host and the admin, who may read the row — and only while the hold waits
   * for payment and is inside its deadline (`409`).
   */
  async payment(id: string, user: AuthenticatedUser): Promise<BookingPayment> {
    const { booking } = await this.getReadable(id, user);

    if (booking.guestId !== user.id) {
      throw new ForbiddenException("Only the guest of a stay pays for it");
    }

    if (
      booking.status !== BookingStatus.PENDING_PAYMENT ||
      booking.expiresAt === null ||
      new Date(booking.expiresAt) <= new Date()
    ) {
      throw new ConflictException("This booking is not waiting for payment");
    }

    let opened;

    try {
      opened = await this.paymentGateway.open(id, booking.amount);
    } catch (error) {
      this.logger.error(
        `Could not open the payment of booking ${id}: ${String(error)}`,
      );

      throw new BadGatewayException("The payment could not be opened");
    }

    // The hold was released while the provider answered: the release read no payment to
    // withdraw, so this one is withdrawn here instead of being handed to a page that pays.
    if (!(await this.bookingRepository.attachPayment(id, opened.id))) {
      await this.withdrawPayments([{ paymentId: opened.id }]);

      throw new ConflictException("This booking is not waiting for payment");
    }

    return {
      clientSecret: opened.clientSecret,
      amount: booking.amount,
      currency: CURRENCY,
    };
  }

  /**
   * The job scheduled for one hold's deadline. A hold that is no longer pending — paid,
   * cancelled, already released by the sweep — releases nothing and tells nobody.
   */
  async releaseHold(id: string): Promise<void> {
    await this.announceReleased(await this.bookingRepository.expireHold(id));
  }

  /** The repeatable sweep; the count is what the processor logs. */
  async releaseLapsedHolds(): Promise<number> {
    const released = await this.bookingRepository.expireLapsedHolds();

    await this.announceReleased(released);

    return released.length;
  }

  /**
   * Cancelling is the guest's decision and an admin's, not the owner's: an owner may read
   * the stay (so gets a `403`), a stranger may not (so gets the `404` of `getReadable`).
   * Neither may cancel a stay that has begun (`isCancellableOn`, `409`).
   *
   * **A cancellation is final when it is answered, and its refund follows it.** What goes
   * back is decided here by `refundOnCancel` and written with `CANCELLED` in one statement
   * (`refund_owed`); the `refund-cancellation` job sends it. The request calls no payment
   * provider, so a slow Stripe slows a refund, not the answer. A hold's payment is withdrawn
   * afterwards; one that completes anyway reaches the webhook and goes back.
   *
   * The cancellation matches only the status the refund was decided by — a hold confirmed in
   * between is a `409` to try again — and runs under `whileCancelling`, taken only once the
   * caller is known to be allowed.
   */
  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    await this.mayCancel(id, user);

    const { found, wasHold, cancelled, refundOwed } =
      await this.bookingRepository
        .whileCancelling(id, () => this.cancelReadable(id, user))
        .catch((error: unknown) => {
          if (error instanceof CancellationInProgressError) {
            throw new ConflictException(
              "The booking is being cancelled by another request — try again",
            );
          }

          throw error;
        });
    const { booking, listingOwnerId } = found;

    // The hold no longer needs releasing; the job is idempotent, so this is a tidy-up and
    // fails silently for the same reason scheduling one does.
    await this.bookingJobs.cancelExpiry(id);

    // The payment is the one the cancelled row named, so one a payment page attached a
    // moment ago goes too.
    if (wasHold) {
      await this.withdrawPayments([cancelled]);
    }

    if (refundOwed !== null) {
      await this.bookingJobs.refundCancellation(id);
    }

    await this.notifyCancellation(booking, listingOwnerId, user);
    await this.waitlistService.announceFreed([booking]);
  }

  /** The `404` of a row the caller may not read, then the `403` of one they may only read. */
  private async mayCancel(id: string, user: AuthenticatedUser): Promise<void> {
    const { booking } = await this.getReadable(id, user);

    if (!ownsOrIsAdmin(user, booking.guestId)) {
      throw new ForbiddenException("This booking cannot be cancelled by you");
    }
  }

  /** The half of `remove` that runs under the lock: the fresh read, what is owed, the write. */
  private async cancelReadable(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{
    found: BookingWithListingOwner;
    wasHold: boolean;
    cancelled: CancelledStay;
    refundOwed: number | null;
  }> {
    const found = await this.getReadable(id, user);
    const { booking } = found;

    if (!isCancellable(booking.status)) {
      throw new NotFoundException(`Booking ${id} not found`);
    }

    // The same day for the guest and for an admin: once the stay has begun, neither lets it go.
    if (!isCancellableOn(booking, toIsoDate(new Date()))) {
      throw new ConflictException(
        "A stay that has begun can no longer be cancelled",
      );
    }

    // Read before the cancellation rather than after it: what is withdrawn afterwards depends
    // on what the stay was, and the row is about to say something else.
    const wasHold = booking.status === BookingStatus.PENDING_PAYMENT;
    const refundOwed = this.refundOwedOnCancel(found, user);
    const cancelled = await this.bookingRepository.cancel(
      id,
      booking.status,
      refundOwed,
    );

    if (cancelled === null) return this.refuseChangedCancellation(id);

    return { found, wasHold, cancelled, refundOwed };
  }

  /**
   * Why a cancellation matched nothing. Gone from the active set — cancelled by a request
   * racing this one, or released — is the `404` cancelling twice always was. Still active
   * means the hold was paid for in between, and that is a `409` worth retrying.
   */
  private async refuseChangedCancellation(id: string): Promise<never> {
    const now = await this.bookingRepository.findByIdWithListingOwner(id);

    if (now !== null && isCancellable(now.booking.status)) {
      throw new ConflictException(
        "The booking changed while it was being cancelled — try again",
      );
    }

    throw new NotFoundException(`Booking ${id} not found`);
  }

  /**
   * What cancelling this stay gives back — `null` for nothing: no payment behind it, outside
   * the free window, refunded in full already, or a dispute lost (the bank returned the
   * money). An open dispute is a `409`: Stripe refuses to refund a disputed payment.
   */
  private refundOwedOnCancel(
    { booking, paymentId }: BookingWithListingOwner,
    user: AuthenticatedUser,
  ): number | null {
    if (booking.status !== BookingStatus.CONFIRMED || paymentId === null) {
      return null;
    }

    if (booking.dispute === DisputeStatus.OPEN) {
      throw new ConflictException(
        "The payment of this stay is disputed with the bank — it can be cancelled once the dispute is settled",
      );
    }

    if (booking.dispute === DisputeStatus.LOST) return null;

    const owed = Math.min(
      refundOnCancel(
        booking,
        new Date(),
        user.role === Role.ADMIN ? "ADMIN" : "GUEST",
      ),
      roundCents(booking.amount - (booking.refundedAmount ?? 0)),
    );

    return owed > 0 ? owed : null;
  }

  /**
   * The `refund-cancellation` job, and the sweep's: sends what a cancellation owes and
   * records it, under `whileCancelling` so the refund's webhook reads it as this
   * cancellation's. A failure is thrown and the debt stays on the row. The host's share is
   * settled afterwards, best effort — the refund's webhook settles it again.
   */
  async refundCancellation(id: string): Promise<boolean> {
    const refunded = await this.bookingRepository.whileCancelling(id, () =>
      this.sendOwedRefund(id),
    );

    if (!refunded) return false;

    try {
      await this.stayLifecycle.refunded(id);
    } catch (error) {
      this.logger.warn(
        `Could not take back the payout of booking ${id} yet, the refund's webhook settles it: ${String(error)}`,
      );
    }

    return true;
  }

  /**
   * The debts still on the rows, `SWEEP_BATCH` at a time; one failure is logged and left
   * for the next minute.
   */
  async refundOwedCancellations(): Promise<number> {
    let sent = 0;

    for (const id of await this.bookingRepository.findOwedRefunds(
      SWEEP_BATCH,
    )) {
      try {
        if (await this.refundCancellation(id)) sent += 1;
      } catch (error) {
        // Taken by the refund job between the read and here: its business, not a failure.
        if (error instanceof CancellationInProgressError) continue;

        this.logger.error(
          `Could not refund the cancellation of booking ${id}, trying again next sweep: ${String(error)}`,
        );
      }
    }

    return sent;
  }

  /**
   * The refund, capped by what is left of the payment — read from Stripe as well as the row,
   * since a dashboard refund's webhook may not have arrived, and Stripe refuses a refund
   * larger than the rest. The total recorded starts from the row: the part it does not know
   * of is the dashboard's, and that webhook tells the guest.
   */
  private async sendOwedRefund(id: string): Promise<boolean> {
    const found = await this.bookingRepository.findByIdWithListingOwner(id);
    const owed = found?.booking.refundOwed ?? null;

    // Paid already, by the job or the sweep racing it.
    if (found === null || owed === null) return false;

    const { booking, paymentId } = found;

    // Opened after the cancellation: Stripe refuses to refund a disputed payment, so the
    // debt waits for the outcome. The sweep asks again every minute, without calling Stripe.
    if (booking.dispute === DisputeStatus.OPEN) return false;

    if (booking.dispute === DisputeStatus.LOST || paymentId === null) {
      await this.bookingRepository.settleOwedRefund(id, null);

      return false;
    }

    const refundedBefore = booking.refundedAmount ?? 0;
    const refundedAtProvider =
      await this.paymentGateway.refundedSoFar(paymentId);
    const amount = Math.min(
      owed,
      roundCents(booking.amount - Math.max(refundedBefore, refundedAtProvider)),
    );

    if (amount <= 0) {
      await this.bookingRepository.settleOwedRefund(id, null);

      return false;
    }

    // One cancellation per booking, so the key needs no amount: a retry after a lost answer
    // finds the refund already sent rather than sending a second one.
    const sent = await this.paymentGateway.refund(
      paymentId,
      amount,
      `booking-${id}-cancellation`,
    );

    await this.bookingRepository.settleOwedRefund(
      id,
      sent > 0 ? roundCents(refundedBefore + sent) : null,
    );

    return sent > 0;
  }

  /** The `withdraw-payment` job; it throws, so an unreachable provider is tried again. */
  async withdrawPayment(paymentId: string): Promise<void> {
    await this.paymentGateway.cancel(paymentId);
  }

  /** Queued rather than called here: nobody who let a hold go should wait on Stripe for it. */
  private async withdrawPayments(
    holds: readonly { paymentId: string | null }[],
  ): Promise<void> {
    for (const { paymentId } of holds) {
      if (paymentId !== null) {
        await this.bookingJobs.withdrawPayment(paymentId);
      }
    }
  }

  /**
   * Two of the three expiry paths: the two sides of each hold first, then their payments,
   * then whoever was waiting for its nights. The third, inside `create`, tells the waitlist
   * only after the new hold is in.
   */
  private async announceReleased(released: ReleasedHold[]): Promise<void> {
    await this.notifyExpiry(released);
    await this.withdrawPayments(released);
    await this.waitlistService.announceFreed(released.map(({ stay }) => stay));
  }

  /**
   * The host hears about a hold the moment it is taken, not when it is paid: the nights are
   * off the calendar from now on, and a hold is the earliest a host can know a stay is
   * coming.
   */
  private async notifyOwnerOf(
    booking: Booking,
    listingOwnerId: string,
  ): Promise<void> {
    await this.notificationService.notify(listingOwnerId, {
      type: NotificationType.BOOKING_REQUESTED,
      data: stayNoticeOf(booking),
    });
  }

  /**
   * Both sides of the stay hear about a cancellation except the one who made it: a guest's
   * reaches the host, an admin's reaches both. Each is told which side of the stay they are,
   * because "your stay" and "a stay at your listing" are different news.
   */
  private async notifyCancellation(
    booking: Booking,
    listingOwnerId: string,
    canceller: AuthenticatedUser,
  ): Promise<void> {
    await notifyBothSides(
      this.notificationService,
      NotificationType.BOOKING_CANCELLED,
      { stay: stayNoticeOf(booking), guestId: booking.guestId, listingOwnerId },
      canceller.id,
    );
  }

  /**
   * Both sides of a lapsed hold hear about it, because nobody let it go on purpose: the
   * guest learns the nights are no longer theirs, the host that they are back on the
   * calendar. The holds are told about one after another rather than all at once — the
   * sweep can release a backlog, and every notice is a transaction of its own.
   */
  private async notifyExpiry(holds: ReleasedHold[]): Promise<void> {
    for (const hold of holds) {
      await notifyBothSides(
        this.notificationService,
        NotificationType.BOOKING_EXPIRED,
        hold,
      );
    }
  }

  /**
   * 404 rather than 403 for a booking the caller may not read, and unlike the listing
   * catalogue that is not a formality: nothing lets a stranger list bookings, so a 403
   * here would be the one way to learn that an id exists at all. What the caller may not
   * see is therefore indistinguishable from what is not there.
   *
   * A cancelled or expired stay is not in that category: its guest may read it, and the
   * `status` on the answer is what says the slot was let go of. Cancelling it a second
   * time is refused one step further on, by the repository, which narrows to the active
   * set the way every rule about the slot does.
   *
   * Who may read: the guest who booked it, the owner of the listing it takes, an admin.
   * `ownsOrIsAdmin` covers the first and the last; the owner of the listing is the reason
   * the repository hands the booking back with that column beside it.
   */
  private async getReadable(
    id: string,
    user: AuthenticatedUser,
  ): Promise<BookingWithListingOwner> {
    const found = await this.bookingRepository.findByIdWithListingOwner(id);

    if (
      found === null ||
      (!ownsOrIsAdmin(user, found.booking.guestId) &&
        !ownsOrIsAdmin(user, found.listingOwnerId))
    ) {
      throw new NotFoundException(`Booking ${id} not found`);
    }

    return found;
  }
}

/**
 * How many owed refunds one sweep sends: each is a call or two to Stripe, one after another,
 * and the sweep a minute later takes the rest.
 */
const SWEEP_BATCH = 50;

/** What a notice about a stay copies off it — see `stayNoticeSchema` in the contract. */
export function stayNoticeOf(booking: Booking): StayNotice {
  return {
    bookingId: booking.id,
    listingId: booking.listingId,
    listingTitle: booking.listing.title,
    from: booking.from,
    to: booking.to,
  };
}
