import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  NotificationType,
  Role,
  StayParty,
  type Booking,
  type BookingPage,
  type StayNotice,
  type BookingQuery,
  type CreateBookingInput,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ownsOrIsAdmin } from "../auth/ownership";
import { readCursor, type Page } from "../common/paging";
import { NotificationService } from "../notification/notification.service";
import {
  BookingRepository,
  DatesUnavailableError,
  GuestNotFoundError,
  ListingNotFoundError,
  type BookingWithListingOwner,
} from "./booking.repository";
import {
  decodeCursor,
  encodeCursor,
  type BookingCursor,
} from "./booking-cursor";
import { BookingExpiryQueue } from "./booking-expiry.queue";

@Injectable()
export class BookingService {
  constructor(
    private readonly bookingRepository: BookingRepository,
    private readonly bookingExpiryQueue: BookingExpiryQueue,
    private readonly notificationService: NotificationService,
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
   * Not a filter the client may pass, but the scope its role gives it: a guest sees the
   * stays they booked, an owner the stays booked against their listings, an admin all of
   * them. A `?guestId=` parameter in its place would leave the same rule to be re-checked
   * on every call — this way the query cannot return a row the caller may not see, and the
   * `guestId` the contract does offer narrows that scope instead of replacing it (the
   * repository `AND`s the two rather than spreading them, which is what makes that true).
   *
   * A role picks one of three named queries rather than assembling a `where`, so there is
   * no shape an unhandled role could fall through to. The switch is exhaustive on purpose
   * — a fourth role added to the contract stops compiling here — and its `default` assigns
   * the role to `never` and throws, because the type is not the whole guarantee: the role
   * arrives in a signed access token that `JwtStrategy` does not parse against the
   * contract, so one minted before a role was renamed still carries the old name for as
   * long as `JWT_ACCESS_TTL`.
   *
   * An owner sees the stays against their listings and not the ones they took as a guest —
   * a role is one persona here, and `@Roles(Role.USER)` on `create` keeps it that way.
   */
  private pageFor(
    user: AuthenticatedUser,
    query: BookingQuery,
    cursor: BookingCursor | null,
  ): Promise<Page<Booking>> {
    switch (user.role) {
      case Role.ADMIN:
        return this.bookingRepository.findPageForEveryone(query, cursor);
      case Role.OWNER:
        return this.bookingRepository.findPageForListingOwner(
          user.id,
          query,
          cursor,
        );
      case Role.USER:
        return this.bookingRepository.findPageForGuest(user.id, query, cursor);
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
   * and settles overlaps inside a transaction, and this method only translates the three
   * failures it can raise. On success it schedules the hold's expiry, and that call cannot
   * fail this request: the booking is committed by then, so a Redis that is down would
   * otherwise answer an existing booking with a 500 and never hand the caller its id. The
   * repeatable sweep behind the queue releases a hold whose job never got written.
   *
   * The owner of the listing is told last, and that cannot fail the request either — see
   * `NotificationService.notify`.
   */
  async create(guestId: string, input: CreateBookingInput): Promise<Booking> {
    let created: BookingWithListingOwner;

    try {
      created = await this.bookingRepository.create(guestId, input);
    } catch (error) {
      // A hard delete of the listing from outside the API — retiring one leaves the row.
      if (error instanceof ListingNotFoundError) {
        throw new NotFoundException(error.message);
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

      throw error;
    }

    const { booking, listingOwnerId } = created;

    if (booking.expiresAt !== null) {
      await this.bookingExpiryQueue.scheduleExpiry(
        booking.id,
        new Date(booking.expiresAt),
      );
    }

    await this.notifyOwnerOf(booking, listingOwnerId);

    return booking;
  }

  /**
   * Cancelling is the guest's decision and an admin's, and deliberately not the owner's:
   * an owner reads the bookings against their listings and cannot cancel one out from
   * under a guest. Who may read and who may write are separate rules over the same row,
   * which is why the 403 below sits after the read gate rather than replacing it — an
   * owner who may see the booking is told "not yours to cancel", a stranger who may not
   * see it at all is told nothing, and gets the 404 `getReadable` throws.
   */
  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    const { booking, listingOwnerId } = await this.getReadable(id, user);

    if (!ownsOrIsAdmin(user, booking.guestId)) {
      throw new ForbiddenException("This booking cannot be cancelled by you");
    }

    if (!(await this.bookingRepository.cancel(id))) {
      throw new NotFoundException(`Booking ${id} not found`);
    }

    // The hold no longer needs releasing; the job is idempotent, so this is a tidy-up and
    // fails silently for the same reason scheduling one does.
    await this.bookingExpiryQueue.cancelExpiry(id);
    await this.notifyCancellation(booking, listingOwnerId, user);
  }

  /**
   * The host hears about a hold the moment it is taken, not when it is paid: the nights are
   * off the calendar from now on, and a hold is the earliest a host can know a stay is
   * coming. An owner booking their own listing is not told about it — the same rule as a
   * cancellation, nobody hears about what they did themselves.
   */
  private async notifyOwnerOf(
    booking: Booking,
    listingOwnerId: string,
  ): Promise<void> {
    if (listingOwnerId === booking.guestId) return;

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
    const parties = [
      { userId: booking.guestId, recipient: StayParty.GUEST },
      { userId: listingOwnerId, recipient: StayParty.HOST },
    ].filter(({ userId }) => userId !== canceller.id);

    await Promise.all(
      parties.map(({ userId, recipient }) =>
        this.notificationService.notify(userId, {
          type: NotificationType.BOOKING_CANCELLED,
          data: { ...stayNoticeOf(booking), recipient },
        }),
      ),
    );
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

/** What a notice about a stay copies off it — see `stayNoticeSchema` in the contract. */
function stayNoticeOf(booking: Booking): StayNotice {
  return {
    bookingId: booking.id,
    listingId: booking.listingId,
    listingTitle: booking.listing.title,
    from: booking.from,
    to: booking.to,
  };
}
