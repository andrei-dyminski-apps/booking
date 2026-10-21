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
import { Throttle } from "@nestjs/throttler";
import {
  Role,
  type Listing,
  type ListingAvailability,
  type ListingDetail,
  type ListingPage,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../common/dto/api-error.dto";
import { CATALOGUE_READS } from "../common/throttle";
import { ListingService } from "./listing.service";
import {
  AvailabilityQueryDto,
  CreateListingDto,
  ListingAvailabilityDto,
  ListingDetailDto,
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
 * The three reading routes are `@Public()`: a catalogue nobody can see before signing up
 * is not a catalogue, and the frontend caches those answers in a Data Cache keyed by URL
 * and shared between visitors — a read that needed a session would either have to be left
 * uncached or be served to the next visitor along with it. Nothing personal is in them;
 * what a listing shows is the same for everybody.
 *
 * Writing to the catalogue is the owner's business, and an admin's. Any user may publish a
 * listing — hosting is not a role, it is owning a row — so the two
 * `@Roles(Role.USER, Role.ADMIN)` routes carry a second check inside the service: the role
 * says the caller may edit listings, only the row says which ones.
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
  @Roles(Role.USER)
  @ApiOkResponse({ type: ListingDto, isArray: true })
  findMine(@CurrentUser() user: AuthenticatedUser): Promise<Listing[]> {
    return this.listingService.findByOwner(user.id);
  }

  @Get(":id")
  @Public()
  @Throttle(CATALOGUE_READS)
  @ApiOkResponse({ type: ListingDetailDto })
  @ApiNotFoundResponse({
    description: "The listing does not exist, or has been retired",
    type: ApiErrorDto,
  })
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<ListingDetail> {
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
  @Roles(Role.USER)
  @ApiCreatedResponse({ type: ListingDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateListingDto,
  ): Promise<Listing> {
    return this.listingService.create(user.id, dto);
  }

  @Patch(":id")
  @Roles(Role.USER, Role.ADMIN)
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
  @Roles(Role.USER, Role.ADMIN)
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
