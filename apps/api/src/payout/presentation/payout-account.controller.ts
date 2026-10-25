import { Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import {
  ApiBadGatewayResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Role, type AccountSession, type HostAccount } from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../../common/dto/api-error.dto";
import { PayoutService } from "../application/payout.service";
import { AccountSessionDto, HostAccountDto } from "./dto/payout.dto";

/**
 * The caller's own payout account — no account id in any route, so nobody reaches anybody
 * else's. A `USER` only: hosting is owning a listing, any user may, and an admin hosts
 * nothing.
 */
@Controller("payouts/account")
@Roles(Role.USER)
export class PayoutAccountController {
  constructor(private readonly payoutService: PayoutService) {}

  /** Where the caller stands, as the row says it — a read that asks Stripe nothing. */
  @Get()
  @ApiOkResponse({ type: HostAccountDto })
  @ApiUnauthorizedResponse({
    description: "The account behind the session is gone",
    type: ApiErrorDto,
  })
  account(@CurrentUser() user: AuthenticatedUser): Promise<HostAccount> {
    return this.payoutService.account(user);
  }

  /**
   * Asks Stripe where an unfinished onboarding stands and writes down the answer — what the
   * payouts screen calls when a host comes back from the form, before the account event has
   * landed. A `POST`, because it writes the flag and may queue the payouts that waited.
   */
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: HostAccountDto })
  @ApiUnauthorizedResponse({
    description: "The account behind the session is gone",
    type: ApiErrorDto,
  })
  refresh(@CurrentUser() user: AuthenticatedUser): Promise<HostAccount> {
    return this.payoutService.refresh(user);
  }

  /**
   * A session for Stripe's embedded components, opening the account on the first call. A
   * `POST` because it creates — the account the first time, a session every time — and a
   * session is never cached: the components ask for a fresh one whenever theirs runs out.
   */
  @Post("session")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AccountSessionDto })
  @ApiBadGatewayResponse({
    description: "The payment provider could not be reached",
    type: ApiErrorDto,
  })
  session(@CurrentUser() user: AuthenticatedUser): Promise<AccountSession> {
    return this.payoutService.session(user);
  }
}
