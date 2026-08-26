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
  GuestNotFoundError,
  ListingNotFoundError,
  type BookingWithListingOwner,
} from "./booking.repository";

@Injectable()
export class BookingService {
  constructor(private readonly bookingRepository: BookingRepository) {}

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

  async create(guestId: string, input: CreateBookingInput): Promise<Booking> {
    if (!(await this.bookingRepository.listingExists(input.listingId))) {
      throw new NotFoundException(`Listing ${input.listingId} not found`);
    }

    // The check and the insert are not atomic — phase 4 of the plan closes the
    // race between concurrent requests (transaction + EXCLUDE constraint in the DB).
    const conflict = await this.bookingRepository.findOverlapping(input);

    if (conflict !== null) {
      throw new ConflictException(
        `Listing ${input.listingId} is already booked from ${conflict.from} to ${conflict.to}`,
      );
    }

    try {
      return await this.bookingRepository.create(guestId, input);
    } catch (error) {
      // The listing row is gone between the check above and the insert — a hard delete
      // from outside the API, since retiring one leaves the row in place.
      if (error instanceof ListingNotFoundError) {
        throw new NotFoundException(error.message);
      }

      // The guest is gone instead: nothing checks that row beforehand, because the token
      // names it and JwtStrategy reads no database. A signed token whose row is gone is an
      // ended session, so this is the 401 of `/auth/me` and not a 404 about the listing.
      if (error instanceof GuestNotFoundError) {
        throw new UnauthorizedException("Session no longer exists");
      }

      throw error;
    }
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

    if (!(await this.bookingRepository.delete(id))) {
      throw new NotFoundException(`Booking ${id} not found`);
    }
  }

  /**
   * 404 rather than 403 for a booking the caller may not read, and unlike the listing
   * catalogue that is not a formality: nothing lets a stranger list bookings, so a 403
   * here would be the one way to learn that an id exists at all. What the caller may not
   * see is therefore indistinguishable from what is not there.
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
