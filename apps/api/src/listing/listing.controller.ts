import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
} from "@nestjs/swagger";
import { Throttle, minutes } from "@nestjs/throttler";
import {
  Role,
  type Listing,
  type ListingAvailability,
  type ListingPage,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../common/dto/api-error.dto";
import { ListingService } from "./listing.service";
import {
  AvailabilityQueryDto,
  CreateListingDto,
  ListingAvailabilityDto,
  ListingDto,
  ListingPageDto,
  ListingQueryDto,
  UpdateListingDto,
} from "./dto/listing.dto";

/**
 * The second reason the two managing routes answer 403, and the only one they state here:
 * `@Roles` already documents the first, and Nest joins the two descriptions rather than
 * replacing one with the other, so repeating the role would read back doubled. A route the
 * guard alone can refuse keeps relying on `@Roles` by itself.
 */
const NOT_YOUR_LISTING =
  "The listing exists but belongs to another owner; an admin passes without owning it";

/**
 * The limit the three reading routes carry instead of the API-wide one, and the reason is
 * that "per address" stops meaning "per visitor" for exactly these three.
 *
 * They are the only `@Public()` reads, which is why the frontend caches them — and a
 * cached read is served from that server rather than from a browser: it reaches this API
 * from the frontend's single address, with no `x-forwarded-for` to bucket it by. Attaching
 * one would not help either; the header would go into the Data Cache key and split the
 * shared entry per visitor, which is the opposite of what caching them is for. So every
 * visitor browsing the catalogue arrives here as one client, and the default 120 a minute
 * is a ceiling on the whole site's cache misses rather than on one client's requests.
 *
 * 600 is what a cold cache costs rather than a number picked for the feel of it: a page
 * of the catalogue and a listing beside its availability are three URLs, the frontend
 * stores each of them for a minute, and the filters are free text — so the misses scale
 * with the searches being asked, not with the visitors asking them. It is still a limit:
 * `limit` caps a page at 50 rows and the availability window at a year, so nothing here
 * hands over the table faster than it would without one.
 *
 * A route that stops being public stops needing this — the session buckets it by visitor
 * again, and the default is the right ceiling for that.
 */
const CATALOGUE_READS = { default: { ttl: minutes(1), limit: 600 } };

/**
 * The three reading routes are `@Public()`: a catalogue nobody can see before signing up
 * is not a catalogue, and the frontend caches those answers in a Data Cache keyed by URL
 * and shared between visitors — a read that needed a session would either have to be left
 * uncached or be served to the next visitor along with it. Nothing personal is in them;
 * what a listing shows is the same for everybody.
 *
 * Writing to the catalogue is the owner's business, and an admin's. The two
 * `@Roles(Role.OWNER, Role.ADMIN)` routes carry a second check inside the service — the
 * role says an owner may edit listings, only the row says which ones.
 */
@Controller("listings")
export class ListingController {
  constructor(private readonly listingService: ListingService) {}

  /**
   * The filters and the cursor arrive in the query string rather than in a body, and that
   * is what makes a search a link somebody can send: the frontend keeps them in
   * `searchParams` for the same reason.
   */
  @Get()
  @Public()
  @Throttle(CATALOGUE_READS)
  @ApiOkResponse({ type: ListingPageDto })
  @ApiBadRequestResponse({
    description:
      "The cursor was not issued by this API, or was issued under a different `sort`: a cursor names a place in one ordering, so changing the ordering starts the pages again",
    type: ApiErrorDto,
  })
  findPage(@Query() query: ListingQueryDto): Promise<ListingPage> {
    return this.listingService.findPage(query);
  }

  /** Declared before `:id`: Nest matches routes in declaration order. */
  @Get("mine")
  @Roles(Role.OWNER)
  @ApiOkResponse({ type: ListingDto, isArray: true })
  findMine(@CurrentUser() user: AuthenticatedUser): Promise<Listing[]> {
    return this.listingService.findByOwner(user.id);
  }

  @Get(":id")
  @Public()
  @Throttle(CATALOGUE_READS)
  @ApiOkResponse({ type: ListingDto })
  @ApiNotFoundResponse({
    description: "The listing does not exist, or has been retired",
    type: ApiErrorDto,
  })
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<Listing> {
    return this.listingService.findOne(id);
  }

  /**
   * The nights already taken, for the window the calendar is drawing. It is the same
   * question `POST /bookings` answers with a `409`, asked before a guest fills the form —
   * and it decides nothing: the booking is still refused, or not, inside the transaction
   * that locks the row.
   */
  @Get(":id/availability")
  @Public()
  @Throttle(CATALOGUE_READS)
  @ApiOkResponse({ type: ListingAvailabilityDto })
  @ApiNotFoundResponse({
    description: "The listing does not exist, or has been retired",
    type: ApiErrorDto,
  })
  availability(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() window: AvailabilityQueryDto,
  ): Promise<ListingAvailability> {
    return this.listingService.availability(id, window);
  }

  @Post()
  @Roles(Role.OWNER)
  @ApiCreatedResponse({ type: ListingDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateListingDto,
  ): Promise<Listing> {
    return this.listingService.create(user.id, dto);
  }

  @Patch(":id")
  @Roles(Role.OWNER, Role.ADMIN)
  @ApiOkResponse({ type: ListingDto })
  @ApiNotFoundResponse({
    description: "The listing does not exist",
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: NOT_YOUR_LISTING,
    type: ApiErrorDto,
  })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateListingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Listing> {
    return this.listingService.update(id, dto, user);
  }

  @Delete(":id")
  @Roles(Role.OWNER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({
    description:
      "The listing is retired: out of the catalogue and closed to new bookings. The stays already taken against it keep their record",
  })
  @ApiNotFoundResponse({
    description: "The listing does not exist, or is already retired",
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: NOT_YOUR_LISTING,
    type: ApiErrorDto,
  })
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.listingService.remove(id, user);
  }
}
