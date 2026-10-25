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

/** No account id in any route, so nobody reaches anybody else's. An admin hosts nothing. */
@Controller("payouts/account")
@Roles(Role.USER)
export class PayoutAccountController {
  constructor(private readonly payoutService: PayoutService) {}

  /** Asks Stripe nothing. */
  @Get()
  @ApiOkResponse({ type: HostAccountDto })
  @ApiUnauthorizedResponse({
    description: "The account behind the session is gone",
    type: ApiErrorDto,
  })
  account(@CurrentUser() user: AuthenticatedUser): Promise<HostAccount> {
    return this.payoutService.account(user);
  }

  /** A `POST`: it writes the flag and may queue the payouts that waited. */
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

  /** A `POST`: it creates the account the first time and a session every time. */
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
