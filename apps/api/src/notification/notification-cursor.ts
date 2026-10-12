import {
  notificationSortSchema,
  type Notification,
  type NotificationSort,
} from "@repo/contracts";
import { z } from "zod";
import {
  decodeParts,
  encodeParts,
  type CreatedAtCursor,
} from "../common/paging";

/**
 * The place in one account's feed a page ends — keyset over `created_at` with the id
 * behind it, for the reason every list here is: a notification arriving while somebody
 * pages lands at the top and would shift every offset after it.
 *
 * The feed has one ordering, so the cursor's `sort` is always `newest`; it is still
 * written, because the envelope of `src/common/paging.ts` is the same for every list and a
 * second ordering would otherwise arrive with cursors that cannot say which one they are.
 */
export type NotificationCursor = CreatedAtCursor & { sort: NotificationSort };

const RESOURCE = "notifications";

export function encodeCursor(
  notification: Notification,
  sort: NotificationSort,
): string {
  return encodeParts(RESOURCE, sort, notification.createdAt, notification.id);
}

/** `null` for anything this cannot read, which the caller answers with a `400`. */
export function decodeCursor(raw: string): NotificationCursor | null {
  const parts = decodeParts(RESOURCE, raw, {
    sort: notificationSortSchema,
    id: z.uuid(),
  });

  if (parts === null) return null;

  const createdAt = z.iso.datetime().safeParse(parts.key);

  return createdAt.success
    ? { sort: parts.sort, createdAt: new Date(createdAt.data), id: parts.id }
    : null;
}
