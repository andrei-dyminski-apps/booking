"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ServerEvent } from "@repo/contracts";
import { useServerEvents } from "./use-server-events";

/**
 * Re-renders a server-rendered personal screen while it is on the screen: on an event
 * `concerns` picks out, and on every `sync` except the first. Every listener is handed one
 * when it starts (see `subscribeToServerEvents`), and that one describes the page that was
 * just rendered; any later `sync` follows a gap — a dropped connection, a laptop that slept
 * — and whatever arrived during it is on the server, not on the screen.
 *
 * **Refreshes do not pile up.** A burst of events while one render is in flight asks for one
 * more render after it, not one per event: the render already running may have read the
 * server before the last of them, and the one after it reads all of them.
 */
export function useRefreshOnEvents(
  concerns: (event: ServerEvent) => boolean,
): void {
  const router = useRouter();
  const [rendering, startTransition] = useTransition();
  const synced = useRef(false);
  const again = useRef(false);

  const refresh = () => {
    if (rendering) {
      again.current = true;

      return;
    }

    startTransition(() => {
      router.refresh();
    });
  };

  useEffect(() => {
    if (rendering || !again.current) return;

    again.current = false;
    startTransition(() => {
      router.refresh();
    });
  }, [rendering, router]);

  useServerEvents((event) => {
    if (event.type === "sync" && !synced.current) {
      synced.current = true;

      return;
    }

    if (event.type === "sync" || concerns(event)) refresh();
  });
}
