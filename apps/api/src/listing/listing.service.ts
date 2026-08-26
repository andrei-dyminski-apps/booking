import {
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
import { ListingRepository } from "./listing.repository";

/**
 * Which roles may reach these methods at all is decided before them, by RolesGuard on the
 * controller. What is left here is the part a guard cannot answer: whether the row the
 * caller named is theirs.
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

    // Retired between the read above and this update, by its owner or an admin.
    if (updated === null) {
      throw new NotFoundException(`Listing ${id} not found`);
    }

    return updated;
  }

  /**
   * Retires the listing rather than deleting the row, and the stays are the reason. A
   * booking names where it was, so the row has to outlive the offer — the FK is
   * `Restrict` and would refuse the delete outright, which used to reach the owner as a
   * `409` that anyone with one finished stay in their history could never get past. What
   * the owner asks for is that the listing stops being offered, and that is what happens:
   * it leaves the catalogue, leaves their dashboard, answers 404 and takes no new
   * bookings, while the stays already taken against it keep their record.
   *
   * Nothing else is protected by this, and that is the trade: the FK can no longer refuse
   * a booking against a retired listing, because the row is still there. The pre-flight
   * check in `BookingService.create` is the only thing standing there now, and phase 4 is
   * where it becomes atomic — the transaction that locks the listing row to settle
   * overlapping stays is the same one that has to see `deletedAt`.
   */
  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    this.assertMayManage(await this.getListing(id), user);

    // The race the read above cannot close: another admin, or its owner in a second tab,
    // retired the listing first.
    if (!(await this.listingRepository.softDelete(id))) {
      throw new NotFoundException(`Listing ${id} not found`);
    }
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
