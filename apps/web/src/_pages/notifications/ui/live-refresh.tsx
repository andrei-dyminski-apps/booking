"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useServerEvents } from "#shared/lib";

/**
 * What keeps the server-rendered feed current while it is on the screen: any event about
 * the notifications re-renders it, which for a `no-store` read is the whole of what
 * "current" takes. The first page only — a page further down is a place somebody went to,
 * and new rows arriving at the top would not appear on it anyway.
 *
 * A `sync` counts too, except the first: every listener is handed one when it starts (see
 * `subscribeToServerEvents`), and that one describes the page that was just rendered. Any
 * later `sync` follows a gap — a dropped connection, a laptop that slept — and whatever
 * arrived during it is on the server, not on the screen.
 */
export const LiveRefresh = () => {
  const router = useRouter();
  const synced = useRef(false);

  useServerEvents((event) => {
    if (event.type === "sync" && !synced.current) {
      synced.current = true;

      return;
    }

    router.refresh();
  });

  return null;
};
