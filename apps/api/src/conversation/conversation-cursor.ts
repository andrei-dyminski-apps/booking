import { conversationSchema, messageSchema } from "@repo/contracts";
import type { Conversation, Message } from "@repo/contracts";
import { z } from "zod";
import {
  decodeParts,
  encodeParts,
  type CreatedAtCursor,
} from "../common/paging";

/**
 * The two keyset cursors of this module: one over the list of threads, one over the
 * messages of a thread. Neither list offers a choice of ordering, so each carries a fixed
 * `sort` — the envelope has a slot for one, and `readCursor` still answers a mistyped or
 * foreign value with its `400`.
 */

/**
 * The one ordering of `GET /conversations`: the most recently written-to thread first, the
 * id behind it. The key is `last_message_at`, the column the index is built on.
 */
export const RECENT = "recent";

export type ConversationCursor = {
  sort: typeof RECENT;
  lastMessageAt: Date;
  id: string;
};

/**
 * The one ordering of a thread's messages: the newest first, which is the `newest` half of
 * `CREATED_AT_ORDER` — a thread is read from its end and paged back towards its start.
 */
export const NEWEST = "newest";

export type MessageCursor = CreatedAtCursor & { sort: typeof NEWEST };

/** The tags that keep a cursor of one list from reading as a place in another. */
const CONVERSATIONS = "conversations";
const MESSAGES = "messages";

export function encodeConversationCursor(conversation: Conversation): string {
  return encodeParts(
    CONVERSATIONS,
    RECENT,
    conversation.lastMessage.createdAt,
    conversation.id,
  );
}

/**
 * `null` for anything this cannot read, which the caller answers with a `400`. The key is
 * read against the contract's rule for a moment, so a cursor cannot name a time no message
 * could have been written at.
 */
export function decodeConversationCursor(
  raw: string,
): ConversationCursor | null {
  const parts = decodeParts(CONVERSATIONS, raw, {
    sort: z.literal(RECENT),
    id: conversationSchema.shape.id,
  });

  if (parts === null) return null;

  const lastMessageAt =
    conversationSchema.shape.lastMessage.shape.createdAt.safeParse(parts.key);

  return lastMessageAt.success
    ? {
        sort: parts.sort,
        lastMessageAt: new Date(lastMessageAt.data),
        id: parts.id,
      }
    : null;
}

export function encodeMessageCursor(message: Message): string {
  return encodeParts(MESSAGES, NEWEST, message.createdAt, message.id);
}

export function decodeMessageCursor(raw: string): MessageCursor | null {
  const parts = decodeParts(MESSAGES, raw, {
    sort: z.literal(NEWEST),
    id: messageSchema.shape.id,
  });

  if (parts === null) return null;

  const createdAt = messageSchema.shape.createdAt.safeParse(parts.key);

  return createdAt.success
    ? { sort: parts.sort, createdAt: new Date(createdAt.data), id: parts.id }
    : null;
}
