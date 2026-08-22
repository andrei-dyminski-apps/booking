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
import { Role, type Listing } from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { ListingService } from "./listing.service";
import { CreateListingDto, UpdateListingDto } from "./dto/listing.dto";

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
  findAll(): Promise<Listing[]> {
    return this.listingService.findAll();
  }

  /** Declared before `:id`: Nest matches routes in declaration order. */
  @Get("mine")
  @Roles(Role.OWNER)
  findMine(@CurrentUser() user: AuthenticatedUser): Promise<Listing[]> {
    return this.listingService.findByOwner(user.id);
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<Listing> {
    return this.listingService.findOne(id);
  }

  @Post()
  @Roles(Role.OWNER)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateListingDto,
  ): Promise<Listing> {
    return this.listingService.create(user.id, dto);
  }

  @Patch(":id")
  @Roles(Role.OWNER, Role.ADMIN)
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
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.listingService.remove(id, user);
  }
}
