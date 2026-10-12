import {
  notificationPageSchema,
  unreadCountSchema,
  type NotificationPage,
  type NotificationQuery,
  type UnreadCount,
} from "@repo/contracts";
import { apiRequest, queryString, type ReadOptions } from "./http-client";

/**
 * The caller's own feed. Every route is scoped to the session by the API — none of them
 * names an account — so every read here is personal, and a call site that caches one has
 * made a mistake: `no-store` on the server, and the browser never caches a `fetch` anyway.
 */
export const notificationsApi = {
  page: (
    query: NotificationQuery,
    read: ReadOptions,
  ): Promise<NotificationPage> =>
    apiRequest({
      method: "GET",
      path: `/notifications${queryString(query)}`,
      schema: notificationPageSchema,
      read,
    }),

  unreadCount: (): Promise<UnreadCount> =>
    apiRequest({
      method: "GET",
      path: "/notifications/unread-count",
      schema: unreadCountSchema,
      read: { cache: "no-store" },
    }),

  /** Answers what is left unread, which is what the bell shows next. */
  markRead: (id: string): Promise<UnreadCount> =>
    apiRequest({
      method: "POST",
      path: `/notifications/${encodeURIComponent(id)}/read`,
      schema: unreadCountSchema,
    }),

  markAllRead: (): Promise<UnreadCount> =>
    apiRequest({
      method: "POST",
      path: "/notifications/read",
      schema: unreadCountSchema,
    }),
};
