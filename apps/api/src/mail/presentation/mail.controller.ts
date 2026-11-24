import { Body, Controller, Get, HttpCode, Patch, Post } from "@nestjs/common";
import {
  ApiOperation,
  ApiTags,
  ApiNoContentResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiOkResponse,
} from "@nestjs/swagger";
import { Throttle, minutes } from "@nestjs/throttler";
import { ApiErrorDto } from "../../common/dto/api-error.dto";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Public } from "../../auth/decorators/public.decorator";
import type { AuthenticatedUser } from "../../auth/auth.types";
import {
  ConfirmMailDto,
  MailPreferencesDto,
  MailSettingsDto,
} from "./dto/mail.dto";
import { MailService } from "../application/mail.service";

@ApiTags("Auth")
@Controller("mail")
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Get("settings")
  @ApiOperation({ summary: "Read your email settings" })
  @ApiOkResponse({ type: MailSettingsDto })
  settings(@CurrentUser() user: AuthenticatedUser) {
    return this.mailService.settings(user.id);
  }

  @Patch("settings")
  @HttpCode(204)
  @ApiOperation({ summary: "Change your email preferences" })
  @ApiNoContentResponse()
  preferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: MailPreferencesDto,
  ) {
    return this.mailService.preferences(user.id, body.muted);
  }

  @Post("resend")
  @Throttle({ default: { ttl: minutes(10), limit: 3 } })
  @HttpCode(204)
  @ApiOperation({ summary: "Request another confirmation email" })
  @ApiNoContentResponse()
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      "Confirmation is unavailable or email delivery is still suppressed",
  })
  resend(@CurrentUser() user: AuthenticatedUser) {
    return this.mailService.resend(user.id);
  }

  @Public()
  @Post("confirm")
  @HttpCode(204)
  @ApiOperation({ summary: "Confirm an email address" })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "The confirmation link is invalid, used or expired",
  })
  confirm(@Body() body: ConfirmMailDto) {
    return this.mailService.confirm(body.token);
  }
}
