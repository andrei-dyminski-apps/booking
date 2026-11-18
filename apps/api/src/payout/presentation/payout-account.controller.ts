import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import {
  Role,
  type AccountSession,
  type HostAccount,
  type PayoutCountries,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../../common/dto/api-error.dto";
import { HostAccountService } from "../application/host-account.service";
import {
  AccountSessionDto,
  HostAccountDto,
  OpenPayoutAccountDto,
  PayoutCountriesDto,
} from "./dto/payout.dto";

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

  /** Stripe's answer, read once per process. */
  @Get("countries")
  @ApiOperation({
    summary: "The countries a payout account can be opened in",
  })
  @ApiOkResponse({ type: PayoutCountriesDto })
  @ApiBadGatewayResponse({
    description: "The payment provider could not be reached",
    type: ApiErrorDto,
  })
  countries(@CurrentUser() user: AuthenticatedUser): Promise<PayoutCountries> {
    return this.hostAccountService.countries(user);
  }

  /** A `POST`: it opens the account at Stripe, once; a second call answers the first. */
  @Post()
  @ApiOperation({ summary: "Open the caller's payout account in a country" })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: HostAccountDto })
  @ApiBadRequestResponse({
    description: "Payouts cannot be sent to an account in that country",
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: "The account behind the token no longer exists",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: "Another request is opening the account",
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: "The payment provider could not be reached",
    type: ApiErrorDto,
  })
  open(
    @Body() dto: OpenPayoutAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<HostAccount> {
    return this.hostAccountService.open(user, dto.country);
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

  /** A `POST`: Stripe makes a new session every time. */
  @Post("session")
  @ApiOperation({
    summary: "Open a Stripe onboarding session for the payout account",
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AccountSessionDto })
  @ApiUnauthorizedResponse({
    description: "The account behind the token no longer exists",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: "No payout account has been opened yet",
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: "The payment provider could not be reached",
    type: ApiErrorDto,
  })
  session(@CurrentUser() user: AuthenticatedUser): Promise<AccountSession> {
    return this.hostAccountService.session(user);
  }
}
