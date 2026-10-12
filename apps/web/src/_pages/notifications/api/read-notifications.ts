import type { NotificationPage, NotificationQuery } from "@repo/contracts";
import { notificationsApi, pageOrNullOnStaleCursor } from "#shared/api";

/**
 * One page of the caller's feed. `no-store`: it is personal, like the stays, and a cursor
 * the API will not read is `null` — the screen says so rather than starting over quietly.
 */
export function readNotifications(
  query: NotificationQuery,
): Promise<NotificationPage | null> {
  return pageOrNullOnStaleCursor(
    () => notificationsApi.page(query, { cache: "no-store" }),
    query.cursor,
  );
}
