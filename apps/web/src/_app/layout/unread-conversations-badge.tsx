"use client";

import { useLatestCount } from "#shared/lib";
import { CountBadge } from "./count-badge";

/**
 * How many threads have news in them, off the account's event stream alone, for the reason
 * the bell's count is (`useLatestCount`).
 *
 * Rendered only where the shell offers a signed-in guest or host the Messages link, so the
 * stream it listens to is always somebody's own.
 */
const useUnreadConversations = (): number =>
  useLatestCount((event) => event.unreadConversations).count ?? 0;

/** The count beside the Messages link. */
export const UnreadConversationsBadge = () => {
  const count = useUnreadConversations();

  if (count === 0) return null;

  return (
    <CountBadge count={count} size="md" className="ml-auto shrink-0">
      <span className="sr-only">{`, ${String(count)} unread`}</span>
    </CountBadge>
  );
};

/**
 * A dot on the menu button below `lg`, where the link and its badge are behind a closed
 * sheet: without it a phone would show news in a thread nowhere at all. The text beside it
 * is part of the button's name, which is why the button names itself by its content.
 */
export const UnreadConversationsDot = () => {
  const count = useUnreadConversations();

  if (count === 0) return null;

  return (
    <>
      <span
        aria-hidden
        className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary"
      />
      <span className="sr-only">{`, ${String(count)} unread conversations`}</span>
    </>
  );
};
