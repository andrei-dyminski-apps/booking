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
import { EXAMPLE_ID, withExample } from "../../common/api-example";

/** The request halves, which the global pipe validates — see `booking.dto.ts` for why a class. */
export class StartConversationDto extends createZodDto(
  withExample(startConversationSchema, {
    listingId: EXAMPLE_ID.listing,
    body: "Hi! Is there a cot for a toddler, and is the street quiet at night?",
  }),
) {}

export class SendMessageDto extends createZodDto(
  withExample(sendMessageSchema, {
    body: "Great, thank you — see you on Friday.",
  }),
) {}

export class MarkReadDto extends createZodDto(
  withExample(markReadSchema, { upTo: "2026-11-15T09:30:00.000Z" }),
) {}

export class ConversationQueryDto extends createZodDto(
  conversationQuerySchema,
) {}

export class MessageQueryDto extends createZodDto(messageQuerySchema) {}

/** Response halves, for `/docs` only: the controller keeps returning the contract types. */
export class ConversationDto extends createZodDto(conversationSchema) {}

export class ConversationPageDto extends createZodDto(conversationPageSchema) {}

export class MessageDto extends createZodDto(messageSchema) {}

export class MessagePageDto extends createZodDto(messagePageSchema) {}
