"use client";

import Link from "next/link";
import type { Notification, UnreadCount } from "@repo/contracts";
import { cn } from "@repo/ui/lib/utils";
import { notificationsApi } from "#shared/api";
import { formatMoment } from "#shared/lib";
import { describeNotification } from "../model/describe-notification";

/**
 * One notification, as the bell and the feed both draw it: a link to what it is about,
 * which marks it read on the way there.
 *
 * The mark is a browser call rather than a Server Action, because the click is a
 * navigation and must not wait for it — a client-side navigation leaves the request
 * running, and the stream tells every tab of the account (this one included) what is left
 * unread. `onRead` hands the count back to a caller that wants it sooner than that.
 */
export const NotificationItem = ({
  notification,
  onNavigate,
  onRead,
  className,
}: {
  notification: Notification;
  /** Called on the click itself — the bell closes its popup. */
  onNavigate?: () => void;
  onRead?: (left: UnreadCount) => void;
  className?: string;
}) => {
  const { title, detail, href } = describeNotification(notification);
  const unread = notification.readAt === null;

  const markRead = () => {
    onNavigate?.();

    if (!unread) return;

    notificationsApi
      .markRead(notification.id)
      .then(onRead)
      .catch((error: unknown) => {
        // A notice left bold is all a failure costs; the next one read repairs the count.
        console.error("Could not mark a notification read", error);
      });
  };

  return (
    <Link
      href={href}
      onClick={markRead}
      className={cn(
        "flex items-start gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          unread ? "bg-primary" : "bg-transparent",
        )}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn("leading-snug", unread && "font-medium")}>
          {title}
          {unread && <span className="sr-only"> (unread)</span>}
        </span>
        <span className="truncate text-muted-foreground">{detail}</span>
        <time
          dateTime={notification.createdAt}
          className="text-xs text-muted-foreground"
        >
          {formatMoment(notification.createdAt)} UTC
        </time>
      </span>
    </Link>
  );
};
