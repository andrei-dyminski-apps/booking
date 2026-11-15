import { Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import {
  ApiBadGatewayResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Role, type AccountSession, type HostAccount } from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../../common/dto/api-error.dto";
import { HostAccountService } from "../application/host-account.service";
import { AccountSessionDto, HostAccountDto } from "./dto/payout.dto";

/** No account id in any route, so nobody reaches anybody else's. An admin hosts nothing. */
@ApiTags("Payouts")
@Controller("payouts/account")
@Roles(Role.USER)
export class PayoutAccountController {
  constructor(private readonly hostAccountService: HostAccountService) {}

  /** Asks Stripe nothing. */
  @Get()
  @ApiOperation({ summary: "The caller's payout account" })
  @ApiOkResponse({ type: HostAccountDto })
  @ApiUnauthorizedResponse({
    description: "The account behind the token no longer exists",
    type: ApiErrorDto,
  })
  account(@CurrentUser() user: AuthenticatedUser): Promise<HostAccount> {
    return this.hostAccountService.account(user);
  }

  /** A `POST`: it writes the flag and may queue the payouts that waited. */
  @Post("refresh")
  @ApiOperation({ summary: "Read the payout account again from Stripe" })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: HostAccountDto })
  @ApiUnauthorizedResponse({
    description: "The account behind the token no longer exists",
    type: ApiErrorDto,
  })
  refresh(@CurrentUser() user: AuthenticatedUser): Promise<HostAccount> {
    return this.hostAccountService.refresh(user);
  }

  /** A `POST`: it creates the account the first time and a session every time. */
  @Post("session")
  @ApiOperation({
    summary: "Open a Stripe onboarding session for the payout account",
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AccountSessionDto })
  @ApiBadGatewayResponse({
    description: "The payment provider could not be reached",
    type: ApiErrorDto,
  })
  session(@CurrentUser() user: AuthenticatedUser): Promise<AccountSession> {
    return this.hostAccountService.session(user);
  }
}
