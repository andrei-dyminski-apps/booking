import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import {
  Role,
  type WaitlistDemandPage,
  type WaitlistEntry,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../common/dto/api-error.dto";
import {
  JoinWaitlistDto,
  WaitlistDemandPageDto,
  WaitlistDemandQueryDto,
  WaitlistDto,
  WaitlistEntryDto,
} from "./dto/waitlist.dto";
import { WaitlistService } from "./waitlist.service";

/**
 * The waitlist, scoped by the session — no account id in any route. `@Roles(Role.USER)` on
 * the class: waiting for nights is wanting to book them, and an admin does not book. The
 * one route an admin reaches is the other side of the list, the ranges waited for on
 * listings, which names both roles itself.
 */
@Controller("waitlist")
@Roles(Role.USER)
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Get()
  @ApiOkResponse({ type: WaitlistDto })
  findMine(@CurrentUser() user: AuthenticatedUser): Promise<WaitlistEntry[]> {
    return this.waitlistService.findMine(user.id);
  }

  /**
   * The ranges waited for on the caller's listings — or, for an admin, on every listing,
   * with who waits. Paged, unlike the caller's own: nothing caps how many wait on one
   * host's listings.
   */
  @Get("demand")
  @Roles(Role.USER, Role.ADMIN)
  @ApiOkResponse({ type: WaitlistDemandPageDto })
  @ApiBadRequestResponse({
    description:
      "The cursor was not issued by this API, or was issued under a different `sort`",
    type: ApiErrorDto,
  })
  findDemand(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: WaitlistDemandQueryDto,
  ): Promise<WaitlistDemandPage> {
    return this.waitlistService.findDemand(user, query);
  }

  /**
   * `201` with the entry, and the same entry again for a range the caller already waits
   * for — joining twice is waiting once.
   */
  @Post()
  @ApiCreatedResponse({ type: WaitlistEntryDto })
  @ApiNotFoundResponse({
    description: "The listing does not exist",
    type: ApiErrorDto,
  })
  // The method's 403 replaces the class's whole, so it restates the role — see
  // `PATCH /users/:id`.
  @ApiForbiddenResponse({
    description:
      "Requires the role USER; the listing is the caller's own, the only stays holding these nights are the caller's own, or the caller already waits for as many ranges as allowed",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: "Nothing holds these nights — book them instead",
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: "The account behind the token no longer exists",
    type: ApiErrorDto,
  })
  join(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: JoinWaitlistDto,
  ): Promise<WaitlistEntry> {
    return this.waitlistService.join(user.id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({
    description:
      "The caller has no such entry — it was never theirs, they left, or they were already told the nights came free",
    type: ApiErrorDto,
  })
  leave(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.waitlistService.leave(user.id, id);
  }
}
