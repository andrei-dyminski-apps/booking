"use client";

import { useCallback, useRef, useState } from "react";
import type { Notification, ServerEvent } from "@repo/contracts";
import { notificationsApi } from "#shared/api";
import { useServerEvents } from "#shared/lib";

/** What the popup shows; the rest is the feed's own page. */
const LATEST = 8;

/**
 * The bell's popup: whether it is open, and the latest notices in it, `null` until they
 * are read.
 *
 * **They are read when the popup opens**, not kept warm: what is in it is only worth the
 * request when somebody looks. A notice that arrives while it is open is put on top of it —
 * unless the read that filled it already had it — and a read elsewhere — another tab, the
 * feed page — invalidates it, so the next opening asks again rather than showing stale bold
 * rows. A notice that arrives while a read is in flight is kept aside and merged into its
 * answer: the server may have read the page before the row existed, and the answer would
 * otherwise replace the list without it. Only the newest read is applied.
 *
 * `failed` is the last read's outcome. A re-read that fails while the popup is open leaves
 * the rows it had on the screen — older is better than nothing — and the next opening asks
 * again.
 */
export const useLatestNotifications = () => {
  const [open, setOpen] = useState(false);
  const [latest, setLatest] = useState<Notification[] | null>(null);
  const [failed, setFailed] = useState(false);
  const arriving = useRef<Notification[] | null>(null);

  const load = useCallback(() => {
    const arrived: Notification[] = [];

    arriving.current = arrived;
    setFailed(false);
    notificationsApi
      .page({ limit: LATEST }, { cache: "no-store" })
      .then((page) => {
        if (arriving.current !== arrived) return;
        arriving.current = null;

        const read = new Set(page.items.map((item) => item.id));

        setLatest(
          [
            ...arrived.filter((item) => !read.has(item.id)),
            ...page.items,
          ].slice(0, LATEST),
        );
      })
      .catch(() => {
        if (arriving.current !== arrived) return;
        arriving.current = null;
        setFailed(true);
      });
  }, []);

  const onOpenChange = (next: boolean) => {
    setOpen(next);

    if (next && (latest === null || failed)) load();
  };

  useServerEvents((event: ServerEvent) => {
    switch (event.type) {
      case "notification.created": {
        const arrived = arriving.current;

        if (arrived?.every((item) => item.id !== event.notification.id)) {
          arrived.unshift(event.notification);
        }

        setLatest((items) =>
          items === null ||
          items.some((item) => item.id === event.notification.id)
            ? items
            : [event.notification, ...items].slice(0, LATEST),
        );
        break;
      }
      case "notifications.read":
      case "sync":
        // Something may have changed while nobody was looking — a reconnect is a gap, and
        // a read elsewhere is news the rows here do not carry.
        if (open) {
          load();
        } else {
          // A read still in flight was answered before this news and would bring it back.
          arriving.current = null;
          setLatest(null);
        }
        break;
    }
  });

  /** What the API's answer to "mark all read" means for the rows already on the screen. */
  const markAllReadLocally = useCallback(() => {
    const now = new Date().toISOString();

    setLatest((items) =>
      items === null
        ? null
        : items.map((item) => ({ ...item, readAt: item.readAt ?? now })),
    );
  }, []);

  return { open, onOpenChange, latest, failed, markAllReadLocally };
};
