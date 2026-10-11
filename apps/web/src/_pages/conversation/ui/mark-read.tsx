"use client";

import { useEffect } from "react";
import { conversationsApi } from "#shared/api";

/**
 * Tells the API the visitor has seen the thread, once it is on their screen — up to the
 * newest message drawn (`upTo`), not up to the moment this effect runs: a message written
 * between the render and here stays news. A write of its own rather than a side effect of
 * the server render: a render can be a prefetch nobody looked at, and a thread marked read
 * by a hover would be news lost. The page only mounts this while the thread is unread.
 *
 * A browser call through the BFF, like the logout: nothing on the screen changes because
 * of it, so a Server Action and the re-render it brings would be spent on nothing. A
 * failure is dropped — the worst it costs is the thread reading as new once more.
 */
export const MarkRead = ({
  conversationId,
  upTo,
}: {
  conversationId: string;
  upTo: string;
}) => {
  useEffect(() => {
    conversationsApi.markRead(conversationId, { upTo }).catch(() => undefined);
  }, [conversationId, upTo]);

  return null;
};
