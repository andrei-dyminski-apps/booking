import { createZodDto } from "nestjs-zod";
import {
  conversationPageSchema,
  conversationQuerySchema,
  conversationSchema,
  markReadSchema,
  messagePageSchema,
  messageQuerySchema,
  messageSchema,
  sendMessageSchema,
  startConversationSchema,
} from "@repo/contracts";

/** The request halves, which the global pipe validates — see `booking.dto.ts` for why a class. */
export class StartConversationDto extends createZodDto(
  startConversationSchema,
) {}

export class SendMessageDto extends createZodDto(sendMessageSchema) {}

export class MarkReadDto extends createZodDto(markReadSchema) {}

export class ConversationQueryDto extends createZodDto(
  conversationQuerySchema,
) {}

export class MessageQueryDto extends createZodDto(messageQuerySchema) {}

/** Response halves, for `/docs` only: the controller keeps returning the contract types. */
export class ConversationDto extends createZodDto(conversationSchema) {}

export class ConversationPageDto extends createZodDto(conversationPageSchema) {}

export class MessageDto extends createZodDto(messageSchema) {}

export class MessagePageDto extends createZodDto(messagePageSchema) {}
