import { z } from "zod";
import { messageSchema } from "./conversation.js";
import { notificationSchema, unreadRevisionSchema } from "./notification.js";

/**
 * The counts every event carries, with the one revision that orders them. One revision
 * for both rather than one each: the two are counted together, under the same lock, so a
 * client keeping the newer event keeps both numbers of one moment.
 */
const UNREAD = {
  unreadNotifications: z.int().min(0),
  /** The threads in which the other side wrote after this account last opened them. */
  unreadConversations: z.int().min(0),
  unreadRevision: unreadRevisionSchema,
};

/**
 * What travels down the one stream a signed-in browser holds open (`GET /events`, as
 * Server-Sent Events). One stream for everything the API pushes rather than one per
 * feature: a browser keeps only so many connections to an origin open, and every tab
 * spends one here — so the messages between users are members of this union, not a
 * second stream.
 *
 * Every event carries the absolute unread count rather than a delta. Two tabs, a dropped
 * connection and a mark-as-read in another window all converge on the number the server
 * last counted, and a client that missed an event is corrected by the next one instead of
 * being off by one for good. The count comes with its `revision` (see
 * `unreadRevisionSchema`), because two events published by two concurrent requests can
 * arrive in the opposite order to the one they were counted in.
 *
 * - `sync` — the first event of every connection, and the answer to whatever was missed
 *   while there was none.
 * - `notification.created` — something new for this account.
 * - `notifications.read` — this account read one or all of them, possibly in another tab.
 * - `message.created` — a message in a thread this account is a side of, sent to both
 *   sides: the other one has news, and the sender's other tabs have a thread to redraw.
 *   The first message of a new thread is one too.
 * - `conversation.read` — this account opened a thread, possibly in another tab.
 */
export const serverEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sync"),
    ...UNREAD,
  }),
  z.object({
    type: z.literal("notification.created"),
    notification: notificationSchema,
    ...UNREAD,
  }),
  z.object({
    type: z.literal("notifications.read"),
    ...UNREAD,
  }),
  z.object({
    type: z.literal("message.created"),
    message: messageSchema,
    ...UNREAD,
  }),
  z.object({
    type: z.literal("conversation.read"),
    conversationId: z.uuid(),
    ...UNREAD,
  }),
]);

export type ServerEvent = z.infer<typeof serverEventSchema>;
export type ServerEventType = ServerEvent["type"];
