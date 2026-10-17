"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellIcon } from "lucide-react";
import type { Notification, ServerEvent, UnreadCount } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import { toast } from "@repo/ui/components/sonner";
import { describeNotification, NotificationItem } from "#entities/notification";
import { notificationsApi } from "#shared/api";
import { ROUTES } from "#shared/config";
import { badgeCount, useLatestCount, useServerEvents } from "#shared/lib";

/** What the popup shows; the rest is the feed's own page. */
const LATEST = 8;

/**
 * The bell in the header: the unread count, kept live by the account's event stream, and
 * the latest few notices in a popup. It is the shell's because every page has it, and it is
 * the only part of the header that holds state of its own.
 *
 * **The count comes from the stream, not from the server render.** Every connection opens
 * with a `sync` and every event after it carries the absolute count, so the number is right
 * a moment after hydration without the shell asking the API once more per page view — the
 * badge simply appears when the stream answers. Rendering it on the server as well would be
 * a second source for one number, and the two would disagree for as long as a cached page
 * outlived a read. The answers to this tab's own reads carry the count too, and the two
 * roads do not keep each other's order — so whichever was counted last wins, by its
 * revision, rather than whichever arrived last (`useLatestCount`).
 *
 * **The list is read when the popup opens**, not kept warm: what is in it is only worth
 * the request when somebody looks. A notice that arrives while it is open is put on top of
 * it — unless the read that filled it already had it — and a read elsewhere — another tab,
 * the feed page — invalidates it, so the next opening asks again rather than showing stale
 * bold rows. A notice that arrives while a read is in flight is kept aside and merged into
 * its answer: the server may have read the page before the row existed, and the answer
 * would otherwise replace the list without it. Only the newest read is applied.
 */
export const NotificationBell = () => {
  const router = useRouter();
  const unread = useLatestCount((event) => event.unreadNotifications);
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

  const { offer } = unread;
  const countUnread = useCallback(
    (next: UnreadCount) => {
      offer(next.unread, next.revision);
    },
    [offer],
  );

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

        const { title, detail, href } = describeNotification(
          event.notification,
        );

        toast(title, {
          description: detail,
          action: { label: "View", onClick: () => router.push(href) },
        });
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

  const onOpenChange = (next: boolean) => {
    setOpen(next);

    if (next && latest === null) load();
  };

  const markAllRead = () => {
    notificationsApi
      .markAllRead()
      .then((left) => {
        const now = new Date().toISOString();

        countUnread(left);
        setLatest((items) =>
          items === null
            ? null
            : items.map((item) => ({ ...item, readAt: item.readAt ?? now })),
        );
      })
      .catch(() => {
        toast.error("Could not mark the notifications read");
      });
  };

  const count = unread.count ?? 0;
  const label =
    count === 0 ? "Notifications" : `Notifications, ${String(count)} unread`;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            className="relative"
          />
        }
      >
        <BellIcon />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-medium text-primary-foreground tabular-nums"
          >
            {badgeCount(count)}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 gap-1 p-1.5">
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <span className="font-medium">Notifications</span>
          {count > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead}>
              Mark all as read
            </Button>
          )}
        </div>

        {failed ? (
          <p className="px-3 py-6 text-center text-muted-foreground">
            Could not load the notifications.
          </p>
        ) : latest === null ? (
          <p className="px-3 py-6 text-center text-muted-foreground">
            Loading…
          </p>
        ) : latest.length === 0 ? (
          <p className="px-3 py-6 text-center text-muted-foreground">
            Nothing yet. Bookings and reviews that concern you will appear here.
          </p>
        ) : (
          <ul role="list" className="flex max-h-96 flex-col overflow-y-auto">
            {latest.map((notification) => (
              <li key={notification.id}>
                <NotificationItem
                  notification={notification}
                  onNavigate={() => setOpen(false)}
                  onRead={countUnread}
                />
              </li>
            ))}
          </ul>
        )}

        <Link
          href={ROUTES.notifications}
          onClick={() => setOpen(false)}
          className="rounded-md px-3 py-2 text-center text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          See all notifications
        </Link>
      </PopoverContent>
    </Popover>
  );
};
