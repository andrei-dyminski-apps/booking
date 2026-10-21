"use client";

import { useRouter } from "next/navigation";
import type { ServerEvent } from "@repo/contracts";
import { toast } from "@repo/ui/components/sonner";
import { describeNotification } from "#entities/notification";
import { useServerEvents } from "#shared/lib";

/**
 * A toast for every notice the account's stream brings, wherever the visitor is. It draws
 * nothing of its own and keeps no state: it is the bell's neighbour rather than a part of
 * it, because a notice is announced whether or not anybody opens the popup — the list in
 * there is read on demand, the announcement is not.
 */
export const NotificationToasts = () => {
  const router = useRouter();

  useServerEvents((event: ServerEvent) => {
    if (event.type !== "notification.created") return;

    const { title, detail, href } = describeNotification(event.notification);

    toast(title, {
      description: detail,
      action: { label: "View", onClick: () => router.push(href) },
    });
  });

  return null;
};
