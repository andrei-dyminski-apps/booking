import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
} from "@nestjs/swagger";
import {
  Role,
  type ManagedUser,
  type ManagedUserDetail,
  type UserPage,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../common/dto/api-error.dto";
import {
  ManagedUserDetailDto,
  ManagedUserDto,
  UpdateUserDto,
  UserPageDto,
  UserQueryDto,
} from "./dto/user.dto";
import { UserService } from "./user.service";

/**
 * Accounts, as the people who run the site see them. Every route is the admin's, so the
 * role is stated once on the class rather than on each handler — `RolesGuard` reads the
 * class as well as the handler, and a route added here later is closed to everybody else
 * without anyone having to remember it.
 *
 * There is no `DELETE`. A user's bookings cascade and their listings restrict, so a delete
 * would either take somebody's stay history with it or be refused for any owner who ever
 * listed anything — blocking is the reversible answer to "this account must stop", and the
 * rows it leaves behind are the record of what the account did.
 */
@Controller("users")
@Roles(Role.ADMIN)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiOkResponse({ type: UserPageDto })
  @ApiBadRequestResponse({
    description:
      "The cursor was not issued by this API, or was issued under a different `sort`",
    type: ApiErrorDto,
  })
  findPage(@Query() query: UserQueryDto): Promise<UserPage> {
    return this.userService.findPage(query);
  }

  @Get(":id")
  @ApiOkResponse({ type: ManagedUserDetailDto })
  @ApiNotFoundResponse({
    description: "The user does not exist",
    type: ApiErrorDto,
  })
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<ManagedUserDetail> {
    return this.userService.findOne(id);
  }

  /**
   * Blocking ends every session the account holds: its refresh tokens are deleted in the
   * same transaction, and the access token left in its browser lapses within
   * `JWT_ACCESS_TTL`.
   */
  @Patch(":id")
  @ApiOkResponse({ type: ManagedUserDto })
  @ApiNotFoundResponse({
    description: "The user does not exist",
    type: ApiErrorDto,
  })
  // Restates the guard's reason as well: a 403 declared on the method replaces the one
  // `@Roles` declares on the class rather than joining it.
  @ApiForbiddenResponse({
    description:
      "Requires the role ADMIN; the account is the caller's own, or the caller has been blocked or demoted since the token was issued",
    type: ApiErrorDto,
  })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ManagedUser> {
    return this.userService.update(user, id, dto);
  }
}
