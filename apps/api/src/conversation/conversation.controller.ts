import {
  Body,
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
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import {
  Role,
  type Conversation,
  type ConversationPage,
  type Message,
  type MessagePage,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../common/dto/api-error.dto";
import { ConversationService } from "./conversation.service";
import {
  ConversationDto,
  ConversationPageDto,
  ConversationQueryDto,
  MessageDto,
  MessagePageDto,
  MarkReadDto,
  MessageQueryDto,
  SendMessageDto,
  StartConversationDto,
} from "./dto/conversation.dto";

const NOT_A_SIDE = {
  description:
    "The conversation does not exist, or the caller is not one of its two sides",
  type: ApiErrorDto,
};

const MALFORMED_CURSOR = {
  description: "The cursor was not issued by this API for this list",
  type: ApiErrorDto,
};

/**
 * The messages between a guest and the host of a listing. Every route is a `USER`'s — one
 * account is a guest of some listings and the host of others — and which threads a caller
 * reaches is decided by the rows rather than here: the scope of the list, and the `404`
 * for anybody who is not one of a thread's two people.
 */
@Controller("conversations")
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Get()
  @Roles(Role.USER)
  @ApiOkResponse({ type: ConversationPageDto })
  @ApiBadRequestResponse(MALFORMED_CURSOR)
  findPage(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ConversationQueryDto,
  ): Promise<ConversationPage> {
    return this.conversationService.findPage(user, query);
  }

  /** Guests write first; a host answers in the thread a guest opened. */
  @Post()
  @Roles(Role.USER)
  @ApiCreatedResponse({ type: ConversationDto })
  @ApiNotFoundResponse({
    description: "The listing does not exist or is no longer offered",
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: "The listing is the caller's own",
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: "The account behind the token no longer exists",
    type: ApiErrorDto,
  })
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartConversationDto,
  ): Promise<Conversation> {
    return this.conversationService.start(user.id, dto);
  }

  @Get(":id")
  @Roles(Role.USER)
  @ApiOkResponse({ type: ConversationDto })
  @ApiNotFoundResponse(NOT_A_SIDE)
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Conversation> {
    return this.conversationService.findOne(id, user);
  }

  /** The thread, the newest message first — it is read from its end. */
  @Get(":id/messages")
  @Roles(Role.USER)
  @ApiOkResponse({ type: MessagePageDto })
  @ApiBadRequestResponse(MALFORMED_CURSOR)
  @ApiNotFoundResponse(NOT_A_SIDE)
  findMessages(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MessageQueryDto,
  ): Promise<MessagePage> {
    return this.conversationService.findMessages(id, user, query);
  }

  @Post(":id/messages")
  @Roles(Role.USER)
  @ApiCreatedResponse({ type: MessageDto })
  @ApiNotFoundResponse(NOT_A_SIDE)
  send(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendMessageDto,
  ): Promise<Message> {
    return this.conversationService.send(id, user, dto);
  }

  /**
   * The caller has seen the thread up to the newest message their screen showed. A write
   * of its own rather than a side effect of reading the messages: a `GET` that changed
   * what the other list says would be marked read by a prefetch nobody looked at.
   */
  @Post(":id/read")
  @Roles(Role.USER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse(NOT_A_SIDE)
  markRead(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MarkReadDto,
  ): Promise<void> {
    return this.conversationService.markRead(id, user, dto);
  }
}
