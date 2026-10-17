"use client";

import type { ServerEventType } from "@repo/contracts";
import { useRefreshOnEvents } from "../lib";

/**
 * What keeps a server-rendered personal list current while it is on the screen: an event of
 * one of the types `on` names re-renders it, which for a `no-store` read is the whole of
 * what "current" takes — and so does a `sync` after a gap (see `useRefreshOnEvents`). A
 * screen mounts it on its first page only — a page further down is a place somebody went
 * to, and new rows arriving at the top would not appear on it anyway.
 *
 * The types arrive as a list rather than a predicate because the screen that names them is
 * a Server Component, and a function cannot cross into a client one.
 */
export const LiveRefresh = ({ on }: { on: readonly ServerEventType[] }) => {
  useRefreshOnEvents((event) => on.includes(event.type));

  return null;
};
