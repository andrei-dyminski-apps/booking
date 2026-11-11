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
  NotificationType,
  RATE_NOT_OFFERED,
  Role,
  StayParty,
  type Booking,
  type BookingDetail,
  type BookingPage,
  type BookingPayment,
  type BookingQuery,
  type CreateBookingInput,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { readCursor, type Page } from "../../common/paging";
import { NotificationService } from "../../notification/notification.service";
import { WaitlistService } from "../../waitlist/waitlist.service";
import { BookingRepository } from "../infrastructure/booking.repository";
import {
  DatesUnavailableError,
  GuestNotFoundError,
  ListingChangedError,
  ListingNotFoundError,
  OwnListingError,
  RateNotOfferedError,
  UnchargeableStayError,
} from "../domain/booking.errors";
import type {
  BookingCursor,
  BookingWithListingOwner,
  CreatedBooking,
  ReleasedHold,
} from "../domain/booking.types";
import {
  PaymentGateway,
  PaymentOpeningInProgressError,
  type OpenedPayment,
} from "../../payment/application/ports/payment-gateway";
import { BookingJobs } from "./ports/booking-jobs";
import { notifyBothSides, stayNoticeOf } from "./stay-notices";
import { readerOf } from "./stay-reader";
import { decodeCursor, encodeCursor } from "./booking-cursor";

/**
 * The application layer of the booking module: HTTP takes, reads and pays for stays, and
 * the BullMQ jobs release unpaid holds and withdraw their payments. The cancellation is
 * `BookingCancellationService`'s, the refund it owes `BookingRefundService`'s, and the
 * provider's news reaches the stays through `BookingPaymentHandler`. It sees neither Prisma,
 * Stripe nor BullMQ — the repository, the `PaymentGateway` port and the `BookingJobs` port —
 * and knows nothing of the host's payout.
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
    const { booking, nights, discountCents } = readerOf(
      user,
      id,
      await this.bookingRepository.findDetailWithListingOwner(id),
    ).found;

    return { ...booking, nights, discountCents };
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

      // A rate the listing does not offer is the request's mistake rather than a change of
      // terms: a client that read the listing before it withdrew the rate gets the `412` above.
      if (error instanceof RateNotOfferedError) {
        throw new BadRequestException(RATE_NOT_OFFERED);
      }

      // Valid dates on a valid listing that add up to more, or less, than a payment can carry.
      if (error instanceof UnchargeableStayError) {
        throw new UnprocessableEntityException(error.refusal);
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
   * set the way every rule about the slot does. `BookingCancellationService` reads its row
   * again under the lease by this same rule.
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
