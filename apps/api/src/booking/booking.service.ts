import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Role, type Booking, type CreateBookingInput } from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ownsOrIsAdmin } from "../auth/ownership";
import {
  BookingRepository,
  DatesUnavailableError,
  GuestNotFoundError,
  ListingNotFoundError,
  type BookingWithListingOwner,
} from "./booking.repository";
import { BookingExpiryQueue } from "./booking-expiry.queue";

@Injectable()
export class BookingService {
  constructor(
    private readonly bookingRepository: BookingRepository,
    private readonly bookingExpiryQueue: BookingExpiryQueue,
  ) {}

  /**
   * Not a filter the client may pass, but the scope its role gives it: a guest sees the
   * stays they booked, an owner the stays booked against their listings, an admin all of
   * them. A `?guestId=` parameter would leave the same rule to be re-checked on every
   * call — this way the query cannot return a row the caller may not see.
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
  findAll(user: AuthenticatedUser): Promise<Booking[]> {
    switch (user.role) {
      case Role.ADMIN:
        return this.bookingRepository.findAll();
      case Role.OWNER:
        return this.bookingRepository.findByListingOwner(user.id);
      case Role.USER:
        return this.bookingRepository.findByGuest(user.id);
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
   */
  async create(guestId: string, input: CreateBookingInput): Promise<Booking> {
    let booking: Booking;

    try {
      booking = await this.bookingRepository.create(guestId, input);
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

    if (booking.expiresAt !== null) {
      await this.bookingExpiryQueue.scheduleExpiry(
        booking.id,
        new Date(booking.expiresAt),
      );
    }

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
    const { booking } = await this.getReadable(id, user);

    if (!ownsOrIsAdmin(user, booking.guestId)) {
      throw new ForbiddenException("This booking cannot be cancelled by you");
    }

    if (!(await this.bookingRepository.cancel(id))) {
      throw new NotFoundException(`Booking ${id} not found`);
    }

    // The hold no longer needs releasing; the job is idempotent, so this is a tidy-up and
    // fails silently for the same reason scheduling one does.
    await this.bookingExpiryQueue.cancelExpiry(id);
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
