import {
  Controller,
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
  ApiNotFoundResponse,
  ApiOkResponse,
} from "@nestjs/swagger";
import type { NotificationPage, UnreadCount } from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ApiErrorDto } from "../common/dto/api-error.dto";
import {
  NotificationPageDto,
  NotificationQueryDto,
  UnreadCountDto,
} from "./dto/notification.dto";
import { NotificationService } from "./notification.service";

/**
 * The caller's own feed, and nothing but the caller's: there is no id of an account in
 * any of these routes, so there is no scope to get wrong and every role reads the same
 * way. The writes answer with the count that is left, which is what the bell shows next.
 */
@Controller("notifications")
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOkResponse({ type: NotificationPageDto })
  @ApiBadRequestResponse({
    description: "The cursor was not issued by this list",
    type: ApiErrorDto,
  })
  findPage(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationQueryDto,
  ): Promise<NotificationPage> {
    return this.notificationService.findPage(user.id, query);
  }

  @Get("unread-count")
  @ApiOkResponse({ type: UnreadCountDto })
  unreadCount(@CurrentUser() user: AuthenticatedUser): Promise<UnreadCount> {
    return this.notificationService.unreadCount(user.id);
  }

  @Post("read")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UnreadCountDto })
  markAllRead(@CurrentUser() user: AuthenticatedUser): Promise<UnreadCount> {
    return this.notificationService.markAllRead(user.id);
  }

  @Post(":id/read")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UnreadCountDto })
  @ApiNotFoundResponse({
    description: "The caller has no notification with this id",
    type: ApiErrorDto,
  })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<UnreadCount> {
    return this.notificationService.markRead(user.id, id);
  }
}
