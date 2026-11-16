"use client";

import { useEffect, useRef } from "react";
import type { ServerEventListener } from "../../api";

/**
 * Listens to the account's event stream for as long as the component is mounted. The
 * connection is shared by every listener of the tab (`subscribeToServerEvents`), so a
 * component pays for a subscription, not for a stream.
 *
 * The latest `listener` is read through a ref, so a handler written inline — which is a new
 * function every render — neither resubscribes nor is called stale.
 */
export function useServerEvents(listener: ServerEventListener): void {
  const latest = useRef(listener);

  useEffect(() => {
    latest.current = listener;
  });

  // The stream is imported when the first listener mounts rather than with this hook. The
  // shell's badges reach the hook on every page, a stranger's included, and the module
  // behind it parses events with the contract's schema — zod in the first load of somebody
  // who never opens a stream. Nothing is lost by the wait: no connection exists before it,
  // and every listener starts with a `sync`. The module is named rather than the segment's
  // barrel, which would bring every resource of `shared/api` into the same chunk.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let unmounted = false;

    import("../../api/server-events").then(
      ({ subscribeToServerEvents }) => {
        if (unmounted) return;

        unsubscribe = subscribeToServerEvents((event) => latest.current(event));
      },
      // A chunk that fails to load — a tab still holding the hashes of the previous deploy
      // — leaves this tab without live counts until it is reloaded. That is no reason to
      // break the page, but it is worth the console rather than an unhandled rejection.
      // Only the load is caught here: a subscription that throws is a bug, and it still
      // surfaces as one instead of being reported as a missing chunk.
      (error: unknown) => {
        console.error("Could not load the event stream", error);
      },
    );

    return () => {
      unmounted = true;
      unsubscribe?.();
    };
  }, []);
}
