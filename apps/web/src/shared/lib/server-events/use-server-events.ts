"use client";

import { useEffect, useRef } from "react";
import { subscribeToServerEvents, type ServerEventListener } from "../../api";

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

  useEffect(
    () => subscribeToServerEvents((event) => latest.current(event)),
    [],
  );
}
