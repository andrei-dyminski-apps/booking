import { z } from "zod";
import { notificationSchema, unreadRevisionSchema } from "./notification.js";

/** The count every event carries, with the revision that orders it. */
const UNREAD = {
  unreadNotifications: z.int().min(0),
  unreadRevision: unreadRevisionSchema,
};

/**
 * What travels down the one stream a signed-in browser holds open (`GET /events`, as
 * Server-Sent Events). One stream for everything the API pushes rather than one per
 * feature: a browser keeps only so many connections to an origin open, and every tab
 * spends one here — so the messages between users, when they arrive, are new members of
 * this union, not a second stream.
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
]);

export type ServerEvent = z.infer<typeof serverEventSchema>;
export type ServerEventType = ServerEvent["type"];
