import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AvailabilityQuery,
  CreateListingInput,
  Listing,
  ListingAvailability,
  ListingPage,
  ListingQuery,
  UpdateListingInput,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ownsOrIsAdmin } from "../auth/ownership";
import { BookingRepository } from "../booking/booking.repository";
import { readCursor } from "../common/paging";
import { decodeCursor, encodeCursor } from "./catalogue-cursor";
import { ListingRepository } from "./listing.repository";

/**
 * Which roles may reach these methods at all is decided before them, by RolesGuard on the
 * controller. What is left here is the part a guard cannot answer: whether the row the
 * caller named is theirs.
 */
@Injectable()
export class ListingService {
  constructor(
    private readonly listingRepository: ListingRepository,
    // The availability of a listing is a question about the stays taken against it, and
    // the rows are bookings: the query and the date mapping stay in the repository that
    // owns them rather than being written a second time in this module.
    private readonly bookingRepository: BookingRepository,
  ) {}

  /**
   * The catalogue. The filters and the ordering are the client's, the cursor is this API's
   * own — an unreadable one is a `400` rather than a silent first page, because a client
   * that got it from `nextCursor` cannot produce a broken one, and answering a different
   * question than the one asked is worse than saying so.
   *
   * `nextCursor` is issued from the last row of the page and only when there is another
   * page: a cursor on the last page would invite one more request for an empty list. It
   * carries the sort it was issued under, so the page after it is the next page of the
   * same list.
   */
  async findPage(query: ListingQuery): Promise<ListingPage> {
    const cursor = readCursor(query.cursor, query.sort, decodeCursor);

    const { items, hasMore } = await this.listingRepository.findPage(
      query,
      cursor,
    );
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last !== undefined ? encodeCursor(last, query.sort) : null,
    };
  }

  /**
   * When the listing is taken, for the window a calendar asks about. A retired listing
   * answers 404 here like everywhere else: its nights are not free, they are not offered.
   */
  async availability(
    id: string,
    window: AvailabilityQuery,
  ): Promise<ListingAvailability> {
    const listing = await this.getListing(id);

    return {
      listingId: listing.id,
      from: window.from,
      to: window.to,
      booked: await this.bookingRepository.findActiveRanges(listing.id, window),
    };
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
