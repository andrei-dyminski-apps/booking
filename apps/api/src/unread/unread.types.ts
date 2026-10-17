import type { ServerEvent } from "@repo/contracts";

/**
 * Everything an account has not read yet, counted at one moment: the notices on the bell,
 * the threads with news in them, and the revision that orders this count against every
 * other one of the same account — see `unreadRevisionSchema` in the contract.
 */
export type UnreadCounts = {
  notifications: number;
  conversations: number;
  revision: number;
};

/** One account's counts, as a write that touched more than one account answers them. */
export type AccountUnread = {
  userId: string;
  counts: UnreadCounts;
};

/** The fields every event of the stream carries. */
export function unreadFieldsOf(
  counts: UnreadCounts,
): Pick<
  ServerEvent,
  "unreadNotifications" | "unreadConversations" | "unreadRevision"
> {
  return {
    unreadNotifications: counts.notifications,
    unreadConversations: counts.conversations,
    unreadRevision: counts.revision,
  };
}
