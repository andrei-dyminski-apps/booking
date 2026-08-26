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
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
} from "@nestjs/swagger";
import { Role, type Listing } from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../common/dto/api-error.dto";
import { ListingService } from "./listing.service";
import {
  CreateListingDto,
  ListingDto,
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
 * Reading the catalogue is open to every signed-in role; writing to it is the owner's
 * business, and an admin's. The two `@Roles(Role.OWNER, Role.ADMIN)` routes carry a second
 * check inside the service — the role says an owner may edit listings, only the row says
 * which ones.
 *
 * The routes stay behind the global JwtAuthGuard for now. A public catalogue is phase 6,
 * where the browsing screens arrive; opening it earlier would be a decision taken without
 * the pagination and the filters that come with it.
 */
@Controller("listings")
export class ListingController {
  constructor(private readonly listingService: ListingService) {}

  @Get()
  @ApiOkResponse({ type: ListingDto, isArray: true })
  findAll(): Promise<Listing[]> {
    return this.listingService.findAll();
  }

  /** Declared before `:id`: Nest matches routes in declaration order. */
  @Get("mine")
  @Roles(Role.OWNER)
  @ApiOkResponse({ type: ListingDto, isArray: true })
  findMine(@CurrentUser() user: AuthenticatedUser): Promise<Listing[]> {
    return this.listingService.findByOwner(user.id);
  }

  @Get(":id")
  @ApiOkResponse({ type: ListingDto })
  @ApiNotFoundResponse({
    description: "The listing does not exist",
    type: ApiErrorDto,
  })
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<Listing> {
    return this.listingService.findOne(id);
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
