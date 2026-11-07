import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PreconditionFailedException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  BookingStatus,
  Canceller,
  cancellerOf,
  DisputeStatus,
  HOST_CANCELLATIONS_THRESHOLD,
  HOST_REASON_REQUIRED,
  hostCancellationFee,
  isCancellableOn,
  notRefunded,
  NotificationType,
  refundQuote,
  Role,
  StayParty,
  type Booking,
  type BookingDetail,
  type BookingPage,
  type BookingPayment,
  type CancelBookingInput,
  type StayNotice,
  type BookingQuery,
  type CreateBookingInput,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { readCursor, type Page } from "../../common/paging";
import { NotificationService } from "../../notification/notification.service";
import { WaitlistService } from "../../waitlist/waitlist.service";
import { BookingRepository } from "../infrastructure/booking.repository";
import {
  CancellationInProgressError,
  DatesUnavailableError,
  GuestNotFoundError,
  ListingChangedError,
  ListingNotFoundError,
  OwnListingError,
  StayTooCheapError,
  StayTooExpensiveError,
} from "../domain/booking.errors";
import type {
  BookingCursor,
  BookingWithListingOwner,
  CancellationBy,
  CancelledStay,
  CreatedBooking,
  ReleasedHold,
} from "../domain/booking.types";
import {
  PaymentGateway,
  PaymentOpeningInProgressError,
  type OpenedPayment,
} from "../../payment/application/ports/payment-gateway";
import { toIsoDate } from "../../common/iso-date";
import { NO_CENTS, type Cents } from "../../payment/domain/money";
import { isCancellable } from "../domain/booking-status";
import { BookingJobs } from "./ports/booking-jobs";
import {
  notifyBothSides,
  notifyBothSidesOfCancellation,
  type CancellationNotice,
} from "./stay-notices";
import { decodeCursor, encodeCursor } from "./booking-cursor";

/**
 * The application layer of the booking module: HTTP takes, reads and cancels stays, and the
 * BullMQ jobs release unpaid holds and withdraw their payments. A cancellation decides its
 * refund and queues it; `BookingRefundService` sends it. The provider's news reaches the
 * stays through `BookingPaymentHandler`. It sees neither Prisma, Stripe nor BullMQ — the
 * repositories, the `PaymentGateway` port and the `BookingJobs` port — and knows nothing of
 * the host's payout.
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

  /** The stay with the nights it was quoted by — read only once the caller may read it. */
  async findOne(id: string, user: AuthenticatedUser): Promise<BookingDetail> {
    const { booking, nights } = readerOf(
      user,
      id,
      await this.bookingRepository.findDetailWithListingOwner(id),
    ).found;

    return { ...booking, nights };
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

      // Not a `409`: the frontend reads that as its calendar being stale, and the nights
      // are free — it is the terms beside them that may have moved.
      if (error instanceof ListingChangedError) {
        throw new PreconditionFailedException(
          "The host has changed this listing since it was shown — review its price and cancellation terms and book again",
        );
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
   * `403` to the host and the admin, who may read the row; `409` outside the hold's deadline,
   * and while another request is opening the same payment.
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

    let opened: OpenedPayment;

    try {
      opened = await this.paymentGateway.open(
        id,
        booking.amountCents,
        booking.currency,
      );
    } catch (error) {
      // Not the provider failing: a second request for the same payment, answered once the
      // first one is.
      if (error instanceof PaymentOpeningInProgressError) {
        throw new ConflictException(
          "The payment is being opened by another request — try again",
        );
      }

      this.logger.error(
        `Could not open the payment of booking ${id}: ${String(error)}`,
      );

      throw new BadGatewayException("The payment could not be opened");
    }

    // Released while the provider answered: the release read no payment to withdraw.
    if (!(await this.bookingRepository.attachPayment(id, opened.id))) {
      await this.withdrawPayments([{ paymentId: opened.id }]);

      throw new ConflictException("This booking is not waiting for payment");
    }

    return {
      clientSecret: opened.clientSecret,
      amountCents: booking.amountCents,
      currency: booking.currency,
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
   * The guest's decision, the host's and an admin's: a stranger may not even read the stay
   * (`404`). A host has to say why (`400` without a reason), refunds the guest in full under
   * any policy and pays a fee for a paid stay, written with the cancellation. The refund is
   * decided here and written with `CANCELLED` (`refund_owed_cents`); a job sends it, so a
   * slow Stripe slows a refund, not the answer.
   */
  async remove(
    id: string,
    user: AuthenticatedUser,
    input: CancelBookingInput = {},
  ): Promise<void> {
    const { canceller, booking: read } = await this.mayCancel(id, user);
    const reason = input.reason ?? null;

    // Before the lease, but only for a row that could be cancelled: one that cannot answers
    // its own `404` or `409` under the lease, and neither ever becomes cancellable again.
    if (
      canceller === Canceller.HOST &&
      reason === null &&
      isCancellableOn(read, toIsoDate(new Date()))
    ) {
      throw new BadRequestException(HOST_REASON_REQUIRED);
    }
    const { found, wasHold, cancelled, refundOwedCents, refundCents } =
      await this.bookingRepository
        .whileCancelling(id, () =>
          this.cancelReadable(id, user, canceller, reason),
        )
        .catch((error: unknown) => {
          if (error instanceof CancellationInProgressError) {
            throw new ConflictException(
              "The booking is being cancelled by another request — try again",
            );
          }

          throw error;
        });
    const { booking, listingOwnerId } = found;

    await this.bookingJobs.cancelExpiry(id);

    // The payment the cancelled row named, so one attached a moment ago goes too.
    if (wasHold) {
      await this.withdrawPayments([cancelled]);
    }

    if (refundOwedCents !== null) {
      await this.bookingJobs.refundCancellation(id);
    }

    await this.notifyCancellation(booking, listingOwnerId, user, {
      refundCents,
      currency: booking.currency,
      cancelledBy: canceller,
      reason,
    });

    if (cancelled.fee !== null) {
      await this.notifyHostFee(booking, listingOwnerId, cancelled.fee);
    }

    await this.waitlistService.announceFreed([booking]);
  }

  /**
   * Who is cancelling, and the row as it was read. Everybody who may read a stay may cancel
   * it, each on their own terms, so the canceller is the reader `readerOf` names — decided
   * by the one rule that answers the `404`, never by elimination after it.
   */
  private async mayCancel(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ canceller: Canceller; booking: Booking }> {
    const { found, reader } = readerOf(
      user,
      id,
      await this.bookingRepository.findByIdWithListingOwner(id),
    );

    return { canceller: reader, booking: found.booking };
  }

  private async cancelReadable(
    id: string,
    user: AuthenticatedUser,
    canceller: Canceller,
    reason: string | null,
  ): Promise<{
    found: BookingWithListingOwner;
    wasHold: boolean;
    cancelled: CancelledStay;
    refundOwedCents: Cents | null;
    refundCents: Cents | null;
  }> {
    const found = await this.getReadable(id, user);
    const { booking } = found;

    if (!isCancellable(booking.status)) {
      throw new NotFoundException(`Booking ${id} not found`);
    }

    const now = new Date();

    // The same day for everybody: once the stay has begun, nobody lets it go.
    if (!isCancellableOn(booking, toIsoDate(now))) {
      throw new ConflictException(
        "A stay that has begun can no longer be cancelled",
      );
    }

    const wasHold = booking.status === BookingStatus.PENDING_PAYMENT;
    const refundCents = this.refundOnCancel(found, canceller, now);
    // The debt the job sends; a refund of nothing is announced but never owed.
    const refundOwedCents =
      refundCents !== null && refundCents > 0 ? refundCents : null;
    const fee =
      canceller === Canceller.HOST
        ? hostCancellationFee(booking, now).cents
        : NO_CENTS;
    const by: CancellationBy = {
      canceller,
      reason,
      feeCents: fee > 0 ? fee : null,
    };
    const cancelled = await this.bookingRepository.cancel(
      id,
      booking.status,
      refundOwedCents,
      by,
    );

    if (cancelled === null) return this.refuseChangedCancellation(id);

    return { found, wasHold, cancelled, refundOwedCents, refundCents };
  }

  /** Still active means the hold was paid for in between: a `409` worth retrying. */
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
   * What cancelling this stay gives back, decided once for the debt the cancellation writes
   * and for what `BOOKING_CANCELLED` tells both sides: `null` when there is no money to
   * speak of — a hold had nothing to give, a lost dispute's money went back through the
   * bank, and a stay refunded in full before it was cancelled has nothing left, where "no
   * refund" would read as the guest losing money they already have — otherwise the amount,
   * nothing included. An open dispute is a `409`: Stripe refuses to refund a disputed
   * payment.
   */
  private refundOnCancel(
    { booking, paymentId }: BookingWithListingOwner,
    canceller: Canceller,
    now: Date,
  ): Cents | null {
    if (booking.status !== BookingStatus.CONFIRMED || paymentId === null) {
      return null;
    }

    if (booking.dispute === DisputeStatus.OPEN) {
      throw new ConflictException(
        "The payment of this stay is disputed with the bank — it can be cancelled once the dispute is settled",
      );
    }

    if (
      booking.dispute === DisputeStatus.LOST ||
      notRefunded(booking.amountCents, booking.refundedAmountCents) === NO_CENTS
    ) {
      return null;
    }

    // The stay's own policy, frozen when it was taken; what was refunded already comes off.
    return refundQuote(booking, now, canceller).cents;
  }

  async withdrawPayment(paymentId: string): Promise<void> {
    await this.paymentGateway.cancel(paymentId);
  }

  /** Queued: nobody who let a hold go should wait on Stripe for it. */
  private async withdrawPayments(
    holds: readonly { paymentId: string | null }[],
  ): Promise<void> {
    await Promise.all(
      holds.flatMap(({ paymentId }) =>
        paymentId === null ? [] : [this.bookingJobs.withdrawPayment(paymentId)],
      ),
    );
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
   * reaches the host, a host's the guest, an admin's both. Each is told which side of the
   * stay they are, because "your stay" and "a stay at your listing" are different news, and
   * who cancelled and why.
   */
  private async notifyCancellation(
    booking: Booking,
    listingOwnerId: string,
    canceller: AuthenticatedUser,
    notice: CancellationNotice,
  ): Promise<void> {
    await notifyBothSidesOfCancellation(
      this.notificationService,
      {
        stay: stayNoticeOf(booking),
        guestId: booking.guestId,
        listingOwnerId,
        notice,
      },
      canceller.id,
    );
  }

  /**
   * The host is told what their cancellation costs, and every admin once a host has
   * cancelled `HOST_CANCELLATIONS_THRESHOLD` paid stays within the window — on every
   * cancellation from then on, since each is news. Neither can fail the cancellation.
   */
  private async notifyHostFee(
    booking: Booking,
    hostId: string,
    fee: { id: string; amountCents: Cents },
  ): Promise<void> {
    await this.notificationService.notify(hostId, {
      type: NotificationType.HOST_CANCELLATION_FEE,
      data: {
        ...stayNoticeOf(booking),
        feeId: fee.id,
        amountCents: fee.amountCents,
        currency: booking.currency,
      },
    });

    let record: { name: string; cancellations: number } | null;

    try {
      record = await this.bookingRepository.hostCancellations(
        hostId,
        new Date(),
      );
    } catch (error) {
      this.logger.error(
        `Could not count the cancellations of host ${hostId}: ${String(error)}`,
      );

      return;
    }

    if (
      record === null ||
      record.cancellations < HOST_CANCELLATIONS_THRESHOLD
    ) {
      return;
    }

    await this.notificationService.notifyAdmins({
      type: NotificationType.HOST_CANCELLATIONS_THRESHOLD,
      data: {
        hostId,
        hostName: record.name,
        cancellations: record.cancellations,
      },
    });
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
   * Who may read: the guest who booked it, the owner of the listing it takes, an admin
   * (`readerOf`); the owner of the listing is the reason the repository hands the booking
   * back with that column beside it.
   */
  private async getReadable(
    id: string,
    user: AuthenticatedUser,
  ): Promise<BookingWithListingOwner> {
    return readerOf(
      user,
      id,
      await this.bookingRepository.findByIdWithListingOwner(id),
    ).found;
  }
}

/**
 * `getReadable`'s rule over a row already read, whatever else was read beside it, answering
 * which of the stay's three readers the caller is — the roles a cancellation is made in, by
 * `cancellerOf`: the guest and the host by the row whatever their role, an admin on somebody
 * else's stay — and the `404` for anybody else.
 */
function readerOf<Found extends BookingWithListingOwner>(
  user: AuthenticatedUser,
  id: string,
  found: Found | null,
): { found: Found; reader: Canceller } {
  const reader =
    found === null
      ? null
      : cancellerOf(
          { guestId: found.booking.guestId, hostId: found.listingOwnerId },
          user,
        );

  if (found === null || reader === null) {
    throw new NotFoundException(`Booking ${id} not found`);
  }

  return { found, reader };
}

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
