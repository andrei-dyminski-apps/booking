import { Controller, Get, Query } from "@nestjs/common";
import { ApiBadRequestResponse, ApiOkResponse } from "@nestjs/swagger";
import { Role, type LookupPage } from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../common/dto/api-error.dto";
import { LookupPageDto, LookupQueryDto } from "./dto/lookup.dto";
import { LookupService } from "./lookup.service";

/**
 * The suggestions of the filter boxes that take an id: a name typed in, the rows it names
 * handed back with their ids, so nobody has to copy a uuid out of an address. One route
 * per box, because each is open to a different set of roles and answers with a different
 * set of rows — the ones its filter can match for the caller.
 *
 * Its own module rather than a route on each resource: an owner may not read `/users`, and
 * the lookups over stays read accounts and listings both, which `BookingModule` could only
 * reach by importing `ListingModule` — the module that already imports it.
 */
@Controller("lookups")
export class LookupController {
  constructor(private readonly lookupService: LookupService) {}

  /** The accounts with a listing on offer: the admin's `?ownerId=` on `/admin`. */
  @Get("owners")
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: LookupPageDto })
  @ApiBadRequestResponse({
    description:
      "The search is too short, or the cursor was not issued by this lookup",
    type: ApiErrorDto,
  })
  owners(@Query() query: LookupQueryDto): Promise<LookupPage> {
    return this.lookupService.owners(query);
  }

  /**
   * The guests of the stays the caller may read: `?guestId=` on `/bookings`. Open to every
   * role, because any account may host — one with no listings is answered an empty page.
   */
  @Get("guests")
  @ApiOkResponse({ type: LookupPageDto })
  @ApiBadRequestResponse({
    description:
      "The search is too short, or the cursor was not issued by this lookup",
    type: ApiErrorDto,
  })
  guests(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LookupQueryDto,
  ): Promise<LookupPage> {
    return this.lookupService.guests(user, query);
  }

  /**
   * The listings of the stays the caller may read, retired ones included: `?listingId=` on
   * `/bookings`. Open to every role, because every role has stays to filter — a guest's
   * own are the scope.
   */
  @Get("listings")
  @ApiOkResponse({ type: LookupPageDto })
  @ApiBadRequestResponse({
    description:
      "The search is too short, or the cursor was not issued by this lookup",
    type: ApiErrorDto,
  })
  listings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LookupQueryDto,
  ): Promise<LookupPage> {
    return this.lookupService.listings(user, query);
  }
}
