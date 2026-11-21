import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Res,
} from "@nestjs/common";
import { Throttle, minutes } from "@nestjs/throttler";
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { AUTH_CONFIG, type AuthConfig } from "../auth/auth.config";
import type { AuthenticatedUser } from "../auth/auth.types";
import { clearAuthCookies } from "../auth/cookies";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ApiErrorDto } from "../common/dto/api-error.dto";
import { DeleteAccountDto } from "./dto/account.dto";
import { AccountService } from "./account.service";

/**
 * The account as its owner sees it. A controller of its own rather than a route of
 * `UserController`, whose every route is the admin's: this one is every signed-in role's,
 * each about their own account, and nobody else's — an admin who needs an account to stop
 * blocks it.
 */
@ApiTags("Users")
@Controller("users")
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
  ) {}

  /**
   * Erases the signed-in account and ends the session it was asked from, its cookies
   * included; every other session went with the refresh tokens the erasure deleted. Held
   * to the login's ceiling, because it answers a guess of the password just as a login does.
   */
  @Delete("me")
  @Throttle({ default: { ttl: minutes(1), limit: 10 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete your own account" })
  @ApiNoContentResponse({
    description:
      "The account is erased: the person is scrubbed, the stays and the money they rest on stay, and the session is over",
  })
  @ApiForbiddenResponse({
    description: "The password is not right",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      "Something is still open on the account — a stay, a dispute, a refund, a payout or a host fee, each with its code and all of them in `params.open` — or the account is the site's last admin's",
    type: ApiErrorDto,
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.accountService.deleteOwn(user, dto);
    clearAuthCookies(res, this.authConfig);
  }
}
