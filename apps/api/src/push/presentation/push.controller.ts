import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import type {
  PushConfig,
  PushPreferences,
  PushSubscriptionStatus,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Public } from "../../auth/decorators/public.decorator";
import { ApiErrorDto } from "../../common/dto/api-error.dto";
import { PushService } from "../application/push.service";
import {
  PushAccountQueryDto,
  PushConfigDto,
  PushMaintenanceDto,
  PushPreferencesDto,
  PushPreferencesPatchDto,
  PushReceiptDto,
  PushSubscriptionDto,
  PushSubscriptionStatusDto,
  PushUnsubscribeDto,
} from "./dto/push.dto";

const accountConflict = {
  description: "The expected account does not match the current session",
  type: ApiErrorDto,
};

/**
 * The browsers of the caller's account, and nothing else's: the subscription is the
 * browser's, the account is the session's. The key is public — it is what every browser
 * subscribes with. Workers authenticate maintenance with the old subscription secret
 * and receipts with the delivery ID.
 */
@ApiTags("Push")
@Controller("push")
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Public()
  @Get("config")
  @ApiOperation({ summary: "The key a browser subscribes to push with" })
  @ApiOkResponse({ type: PushConfigDto })
  config(): PushConfig {
    return this.pushService.config();
  }

  @Post("subscriptions")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Push the caller's notices and messages to this browser",
  })
  @ApiNoContentResponse()
  @ApiConflictResponse({
    description:
      "The browser must create a new subscription or the account has changed",
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: "Push is not configured on this API",
    type: ApiErrorDto,
  })
  subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PushAccountQueryDto,
    @Body() body: PushSubscriptionDto,
  ): Promise<void> {
    this.pushService.requireAccount(user.id, query.accountId);
    return this.pushService.subscribe(user.id, body);
  }

  @Post("subscriptions/status")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Check whether this browser is subscribed to the caller's push notifications",
  })
  @ApiOkResponse({ type: PushSubscriptionStatusDto })
  @ApiConflictResponse(accountConflict)
  subscriptionStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PushAccountQueryDto,
    @Body() body: PushUnsubscribeDto,
  ): Promise<PushSubscriptionStatus> {
    this.pushService.requireAccount(user.id, query.accountId);
    return this.pushService.subscriptionStatus(user.id, body.endpoint);
  }

  @Delete("subscriptions")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Stop pushing to this browser" })
  @ApiNoContentResponse()
  @ApiConflictResponse(accountConflict)
  unsubscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PushAccountQueryDto,
    @Body() body: PushUnsubscribeDto,
  ): Promise<void> {
    this.pushService.requireAccount(user.id, query.accountId);
    return this.pushService.unsubscribe(user.id, body.endpoint);
  }

  @Public()
  @Post("subscriptions/maintenance")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Renew or retire a worker's existing subscription" })
  @ApiNoContentResponse()
  @ApiConflictResponse({
    description: "The existing subscription could not be renewed",
    type: ApiErrorDto,
  })
  maintain(@Body() body: PushMaintenanceDto): Promise<void> {
    return this.pushService.maintain(body);
  }

  @Get("settings")
  @ApiOperation({ summary: "How the caller's account wants to be pushed to" })
  @ApiOkResponse({ type: PushPreferencesDto })
  @ApiConflictResponse(accountConflict)
  preferences(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PushAccountQueryDto,
  ): Promise<PushPreferences> {
    this.pushService.requireAccount(user.id, query.accountId);
    return this.pushService.preferences(user.id);
  }

  @Patch("settings")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Change the groups, the quiet hours and the hourly limit of push",
  })
  @ApiNoContentResponse()
  @ApiConflictResponse(accountConflict)
  savePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PushAccountQueryDto,
    @Body() body: PushPreferencesPatchDto,
  ): Promise<void> {
    this.pushService.requireAccount(user.id, query.accountId);
    return this.pushService.savePreferences(user.id, body);
  }

  @Public()
  @Post("receipts")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Record that a push reached its browser, or was clicked",
  })
  @ApiNoContentResponse()
  receipt(@Body() body: PushReceiptDto): Promise<void> {
    return this.pushService.recordReceipt(body);
  }
}
