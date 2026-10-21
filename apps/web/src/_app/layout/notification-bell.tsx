"use client";

import { useCallback } from "react";
import Link from "next/link";
import { BellIcon } from "lucide-react";
import type { UnreadCount } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import { toast } from "@repo/ui/components/sonner";
import { NotificationItem } from "#entities/notification";
import { notificationsApi } from "#shared/api";
import { ROUTES } from "#shared/config";
import { badgeCount, useLatestCount } from "#shared/lib";
import { useLatestNotifications } from "./use-latest-notifications";

/**
 * The bell in the header: the unread count, kept live by the account's event stream, and
 * the latest few notices in a popup (`useLatestNotifications`). It is the shell's because
 * every page has it, and it is the only part of the header that holds state of its own.
 *
 * **The count comes from the stream, not from the server render.** Every connection opens
 * with a `sync` and every event after it carries the absolute count, so the number is right
 * a moment after hydration without the shell asking the API once more per page view — the
 * badge simply appears when the stream answers. Rendering it on the server as well would be
 * a second source for one number, and the two would disagree for as long as a cached page
 * outlived a read. The answers to this tab's own reads carry the count too, and the two
 * roads do not keep each other's order — so whichever was counted last wins, by its
 * revision, rather than whichever arrived last (`useLatestCount`).
 */
export const NotificationBell = () => {
  const unread = useLatestCount((event) => event.unreadNotifications);
  const { open, onOpenChange, latest, failed, markAllReadLocally } =
    useLatestNotifications();

  const { offer } = unread;
  const countUnread = useCallback(
    (next: UnreadCount) => {
      offer(next.unread, next.revision);
    },
    [offer],
  );

  const markAllRead = () => {
    notificationsApi
      .markAllRead()
      .then((left) => {
        countUnread(left);
        markAllReadLocally();
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

        {latest === null ? (
          <p className="px-3 py-6 text-center text-muted-foreground">
            {failed ? "Could not load the notifications." : "Loading…"}
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
                  onNavigate={() => onOpenChange(false)}
                  onRead={countUnread}
                />
              </li>
            ))}
          </ul>
        )}

        <Link
          href={ROUTES.notifications}
          onClick={() => onOpenChange(false)}
          className="rounded-md px-3 py-2 text-center text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          See all notifications
        </Link>
      </PopoverContent>
    </Popover>
  );
};
