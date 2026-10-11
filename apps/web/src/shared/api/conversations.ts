import { z } from "zod";
import {
  conversationPageSchema,
  conversationSchema,
  messagePageSchema,
  messageSchema,
  type Conversation,
  type ConversationPage,
  type ConversationQuery,
  type MarkReadInput,
  type Message,
  type MessagePage,
  type MessageQuery,
  type SendMessageInput,
  type StartConversationInput,
} from "@repo/contracts";
import { apiRequest, queryString, type ReadOptions } from "./http-client";

/**
 * The routes of the messages between a guest and a host. Every read here is personal —
 * the API scopes a thread to its two sides — so a call site has no reason to pass anything
 * but `no-store`; the option is still required, for the reason it is everywhere else.
 */
export const conversationsApi = {
  /** The threads the caller is a side of, the most recently written-to first. */
  page: (
    query: ConversationQuery,
    read: ReadOptions,
  ): Promise<ConversationPage> =>
    apiRequest({
      method: "GET",
      path: `/conversations${queryString(query)}`,
      schema: conversationPageSchema,
      read,
    }),

  get: (id: string, read: ReadOptions): Promise<Conversation> =>
    apiRequest({
      method: "GET",
      path: `/conversations/${encodeURIComponent(id)}`,
      schema: conversationSchema,
      read,
    }),

  /** One page of a thread, the newest message first. */
  messages: (
    id: string,
    query: MessageQuery,
    read: ReadOptions,
  ): Promise<MessagePage> =>
    apiRequest({
      method: "GET",
      path: `/conversations/${encodeURIComponent(id)}/messages${queryString(query)}`,
      schema: messagePageSchema,
      read,
    }),

  /** Opens the guest's thread about a listing, or continues the one they have. */
  start: (input: StartConversationInput): Promise<Conversation> =>
    apiRequest({
      method: "POST",
      path: "/conversations",
      schema: conversationSchema,
      body: input,
    }),

  send: (id: string, input: SendMessageInput): Promise<Message> =>
    apiRequest({
      method: "POST",
      path: `/conversations/${encodeURIComponent(id)}/messages`,
      schema: messageSchema,
      body: input,
    }),

  /** The caller's side has seen the thread up to `upTo`, the newest message on screen. */
  markRead: (id: string, input: MarkReadInput): Promise<void> =>
    apiRequest({
      method: "POST",
      path: `/conversations/${encodeURIComponent(id)}/read`,
      schema: z.void(),
      body: input,
    }),
};
