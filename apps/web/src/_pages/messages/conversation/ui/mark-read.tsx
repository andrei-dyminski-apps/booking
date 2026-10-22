"use client";

import { useEffect, useRef } from "react";
import { conversationsApi } from "#shared/api";

/**
 * Tells the API the visitor has seen the thread, once it is on their screen — up to the
 * newest message drawn (`upTo`), not up to the moment this effect runs: a message written
 * between the render and here stays news. A write of its own rather than a side effect of
 * the server render: a render can be a prefetch nobody looked at, and a thread marked read
 * by a hover would be news lost. The page only mounts this while the thread is unread.
 *
 * **Only once the end of the thread is on the screen.** What this renders is an empty mark
 * the page places right after the newest message, and the call waits for it to enter the
 * viewport. The page opens at its top, so a page of messages taller than the screen puts
 * the newest one below the fold, and a mark sent on opening would put out the badge for a
 * message nobody has scrolled to. A mark after the list rather than the last message
 * itself: a long message counts as seen once it has been read to its end.
 *
 * **And only while the tab is visible.** An open thread re-renders on every message that
 * arrives, in a background tab as well, and a mark sent from there would put out the badge
 * for a message nobody has looked at. A hidden tab waits until it is shown again.
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
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = end.current;

    if (target === null) return;

    let onScreen = false;

    // One callback may carry several entries for the one target; the last is the latest.
    const observer = new IntersectionObserver((entries) => {
      onScreen = entries.at(-1)?.isIntersecting ?? onScreen;
      settle();
    });

    const stop = () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", settle);
    };

    function settle() {
      if (!onScreen || document.visibilityState !== "visible") return;

      stop();
      conversationsApi
        .markRead(conversationId, { upTo })
        .catch(() => undefined);
    }

    observer.observe(target);
    document.addEventListener("visibilitychange", settle);

    return stop;
  }, [conversationId, upTo]);

  return <div ref={end} aria-hidden />;
};
