import { z } from "zod";
import { userSchema } from "./auth.js";
import { listingSchema } from "./listing.js";
import { blank, PAGING } from "./query.js";

/**
 * Which side of a conversation wrote a message — the guest who asked about a listing, or
 * the host who owns it. A side rather than a role or an account: the two people are fixed
 * by the conversation itself, so a message only has to say which of the two it came from,
 * and a screen tells "yours" from "theirs" by comparing it with the side it reads as.
 */
export const conversationSideSchema = z.enum(["GUEST", "HOST"]);

export const ConversationSide = conversationSideSchema.enum;

/** The longest message one request may carry: a few paragraphs, never a document. */
export const MAX_MESSAGE_LENGTH = 2000;

/**
 * What a person types. Trimmed, because a box that held only spaces and newlines says
 * nothing, and bounded, because every message is drawn whole in a thread.
 */
export const messageBodySchema = z
  .string()
  .trim()
  .min(1, { error: "Write a message first" })
  .max(MAX_MESSAGE_LENGTH, {
    error: `A message may not be longer than ${MAX_MESSAGE_LENGTH} characters`,
  });

export const messageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  sender: conversationSideSchema,
  body: z.string(),
  createdAt: z.iso.datetime(),
});

/**
 * One thread between a guest and the host of one listing. There is exactly one per pair —
 * a guest asking about the same listing again continues the thread they already have.
 *
 * Both people are named by the name they go by and never by address: a guest's address is
 * not the host's to read, and the host's is not the guest's. The listing is what the
 * thread is about, and `side` is which of the two the caller is.
 */
export const conversationSchema = z.object({
  id: z.uuid(),
  listingId: z.uuid(),
  /** The title, resolved whether or not the listing is still offered — the thread outlives the offer. */
  listing: listingSchema.pick({ title: true }),
  guestId: z.uuid(),
  /** The guest who wrote first. */
  guest: userSchema.pick({ name: true }),
  /** Whoever owns the listing now — the host is read through it, never stored on the thread. */
  host: userSchema.pick({ name: true }),
  /** The side the caller is on; the same thread reads as `GUEST` to one and `HOST` to the other. */
  side: conversationSideSchema,
  /** The newest message, which every conversation has: one is started by its first message. */
  lastMessage: messageSchema.pick({
    sender: true,
    body: true,
    createdAt: true,
  }),
  /** Whether the other side wrote something after the caller last opened the thread. */
  unread: z.boolean(),
  createdAt: z.iso.datetime(),
});

/**
 * How a guest opens a thread: the listing it is about and what they want to say. There
 * is no empty conversation — the first message is the reason one exists. The guest is the
 * session, and the host is whoever owns the listing; neither is the client's to name.
 */
export const startConversationSchema = z.object({
  listingId: z.uuid({ error: "Choose a listing to write about" }),
  body: messageBodySchema,
});

export const sendMessageSchema = z.object({
  body: messageBodySchema,
});

/**
 * How far a side has read: the moment of the newest message the screen showed, never the
 * moment the request arrives. A message written between the render and this write is then
 * still news, rather than marked read on a screen that never drew it. A moment later than
 * the thread's newest message reads nothing at all — no message could be shown from there.
 */
export const markReadSchema = z.object({
  upTo: messageSchema.shape.createdAt,
});

/**
 * The query of `GET /conversations`. The scope is the caller's — every thread they are a
 * side of: the ones they started as a guest and the ones about their listings — and
 * `listingId` narrows it: it is how a listing's page asks whether its visitor has written
 * about it already.
 *
 * There is one ordering, the most recent message first, which is the only one a list of
 * conversations is ever read in.
 */
export const conversationQuerySchema = z.object({
  listingId: blank(z.uuid().optional()),
  ...PAGING,
});

/** The messages of one thread, the newest first: a thread is read from its end. */
export const messageQuerySchema = z.object({
  ...PAGING,
});

export const conversationPageSchema = z.object({
  items: z.array(conversationSchema),
  nextCursor: z.string().nullable(),
});

export const messagePageSchema = z.object({
  items: z.array(messageSchema),
  nextCursor: z.string().nullable(),
});

export type ConversationSide = z.infer<typeof conversationSideSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type StartConversationInput = z.infer<typeof startConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type MarkReadInput = z.infer<typeof markReadSchema>;
export type ConversationQuery = z.infer<typeof conversationQuerySchema>;
export type MessageQuery = z.infer<typeof messageQuerySchema>;
export type ConversationPage = z.infer<typeof conversationPageSchema>;
export type MessagePage = z.infer<typeof messagePageSchema>;
