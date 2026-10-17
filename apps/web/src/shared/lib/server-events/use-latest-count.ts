"use client";

import { useCallback, useState } from "react";
import type { ServerEvent } from "@repo/contracts";
import { useServerEvents } from "./use-server-events";

/**
 * One of the unread counts, off the account's event stream: every event carries the
 * absolute number, the first one a moment after hydration, so a server-rendered number
 * would only be a second source to disagree with it. `null` until the stream has answered.
 *
 * **The newer count wins by its revision, not by its arrival.** Two events published by two
 * concurrent requests can arrive in the opposite order to the one they were counted in, and
 * so can the answer to this tab's own read — which is what `offer` is for: a count from
 * somewhere other than the stream, ordered against it by the same rule.
 */
export function useLatestCount(pick: (event: ServerEvent) => number): {
  count: number | null;
  offer: (count: number, revision: number) => void;
} {
  const [latest, setLatest] = useState<{
    count: number;
    revision: number;
  } | null>(null);
  const offer = useCallback((count: number, revision: number) => {
    setLatest((current) =>
      current === null || revision >= current.revision
        ? { count, revision }
        : current,
    );
  }, []);

  useServerEvents((event) => {
    offer(pick(event), event.unreadRevision);
  });

  return { count: latest?.count ?? null, offer };
}
