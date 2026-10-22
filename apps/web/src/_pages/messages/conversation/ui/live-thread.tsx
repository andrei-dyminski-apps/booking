"use client";

import { isAfter, parseISO } from "date-fns";
import { useRefreshOnEvents } from "#shared/lib";

/**
 * Draws a message into the open thread as it arrives: a message of this thread on the
 * account's stream re-renders the page, which reads the thread `no-store`. Both sides hear
 * of every message, so a reply sent from another tab appears here too. A message of another
 * thread is somebody else's screen, and a `sync` after a gap redraws for the reason
 * `useRefreshOnEvents` gives.
 *
 * A message no later than the newest one drawn (`shownUpTo`) is already on the screen — the
 * one this tab just sent, above all, whose action re-rendered the page before its event
 * came back round — and is not worth a second render. The messages of a thread are
 * strictly ordered by their moment, so the comparison is exact.
 *
 * The page mounts this on the newest page only — an earlier one does not show the end of
 * the thread.
 */
export const LiveThread = ({
  conversationId,
  shownUpTo,
}: {
  conversationId: string;
  /** The newest message the page drew, or `undefined` for a thread drawn empty. */
  shownUpTo: string | undefined;
}) => {
  useRefreshOnEvents(
    (event) =>
      event.type === "message.created" &&
      event.message.conversationId === conversationId &&
      (shownUpTo === undefined ||
        isAfter(parseISO(event.message.createdAt), parseISO(shownUpTo))),
  );

  return null;
};
