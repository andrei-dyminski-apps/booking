import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateListingInput,
  Listing,
  UpdateListingInput,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ownsOrIsAdmin } from "../auth/ownership";
import {
  ListingHasBookingsError,
  ListingRepository,
} from "./listing.repository";

/**
 * Which roles may reach these methods at all is decided before them, by RolesGuard on the
 * controller. What is left here is the part a guard cannot answer: whether the row the
 * caller named is theirs — plus the one rule about other rows, that a listing somebody has
 * booked is not deletable.
 */
@Injectable()
export class ListingService {
  constructor(private readonly listingRepository: ListingRepository) {}

  findAll(): Promise<Listing[]> {
    return this.listingRepository.findAll();
  }

  /** The owner's dashboard: their own listings, whether or not anything is booked on them. */
  findByOwner(ownerId: string): Promise<Listing[]> {
    return this.listingRepository.findByOwner(ownerId);
  }

  findOne(id: string): Promise<Listing> {
    return this.getListing(id);
  }

  create(ownerId: string, input: CreateListingInput): Promise<Listing> {
    return this.listingRepository.create(ownerId, input);
  }

  async update(
    id: string,
    input: UpdateListingInput,
    user: AuthenticatedUser,
  ): Promise<Listing> {
    this.assertMayManage(await this.getListing(id), user);

    const updated = await this.listingRepository.update(id, input);

    // Deleted between the read above and this update, by its owner or an admin.
    if (updated === null) {
      throw new NotFoundException(`Listing ${id} not found`);
    }

    return updated;
  }

  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    this.assertMayManage(await this.getListing(id), user);

    // The FK is Restrict, so the database would refuse this anyway — the count is what
    // turns that refusal into an answer the client can act on, and it counts stays that
    // are already over for the same reason: the constraint does too, and a count the
    // database disagrees with would answer 204 and then fail. Letting go of a listing
    // whose history is booked against it is a soft delete, not a narrower count.
    // Phase 4 moves the check inside the transaction that already locks the listing row.
    const bookings = await this.listingRepository.countBookings(id);

    if (bookings > 0) {
      throw new ConflictException(
        `Listing ${id} has ${bookings} booking(s) and cannot be deleted`,
      );
    }

    try {
      if (await this.listingRepository.delete(id)) return;
    } catch (error) {
      // A booking taken against the listing since it was counted — the one race the
      // count above cannot close.
      if (error instanceof ListingHasBookingsError) {
        throw new ConflictException(error.message);
      }

      throw error;
    }

    // The other race: another admin got to the delete first.
    throw new NotFoundException(`Listing ${id} not found`);
  }

  private async getListing(id: string): Promise<Listing> {
    const listing = await this.listingRepository.findById(id);

    if (listing === null) {
      throw new NotFoundException(`Listing ${id} not found`);
    }

    return listing;
  }

  /**
   * 404 first, then 403: the listing catalogue is readable by every signed-in user, so
   * saying "this one exists but is not yours" reveals nothing the caller could not have
   * read from `GET /listings` a moment earlier.
   */
  private assertMayManage(listing: Listing, user: AuthenticatedUser): void {
    if (!ownsOrIsAdmin(user, listing.ownerId)) {
      throw new ForbiddenException("This listing belongs to another owner");
    }
  }
}
