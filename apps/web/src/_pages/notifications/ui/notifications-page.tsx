import { Card, CardContent } from "@repo/ui/components/card";
import { NotificationItem } from "#entities/notification";
import { notificationsApi, requireUser } from "#shared/api";
import { ROUTES } from "#shared/config";
import { singleParam } from "#shared/lib";
import { LiveRefresh, PageHeading, Pager, StalePageNotice } from "#shared/ui";
import { readNotifications } from "../api/read-notifications";
import { MarkAllReadButton } from "./mark-all-read-button";

const PAGE_SIZE = 20;

/**
 * Every notification of the account, newest first — the whole of what the bell shows the
 * top of. The only parameter is the cursor: the feed has one ordering and no filters, so
 * there is no canonical address to redirect to.
 */
export const NotificationsPage = async ({
  searchParams,
}: PageProps<"/notifications">) => {
  await requireUser(ROUTES.notifications);

  const cursor = singleParam((await searchParams).cursor) || undefined;
  // The count of the whole feed rather than of this page: the unread ones are often the
  // older ones, a page or more below the notices the bell already marked.
  const [page, { unread }] = await Promise.all([
    readNotifications({ limit: PAGE_SIZE, cursor }),
    notificationsApi.unreadCount(),
  ]);
  const first = ROUTES.notifications;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Notifications"
        description="Booking requests, cancellations and reviews that concern you."
      />

      {cursor === undefined && (
        <LiveRefresh on={["notification.created", "notifications.read"]} />
      )}

      {page === null ? (
        <StalePageNotice firstPageHref={first} />
      ) : page.items.length === 0 && cursor === undefined ? (
        <p className="text-muted-foreground">
          Nothing yet. When somebody books one of your listings, cancels a stay
          or reviews you, it appears here.
        </p>
      ) : (
        <>
          {unread > 0 && <MarkAllReadButton />}

          <Card size="sm" className="py-1">
            <CardContent className="px-1">
              <ul role="list" className="flex flex-col divide-y divide-border">
                {page.items.map((notification) => (
                  <li key={notification.id}>
                    <NotificationItem notification={notification} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Pager
            nextHref={
              page.nextCursor === null
                ? null
                : `${first}?cursor=${encodeURIComponent(page.nextCursor)}`
            }
            firstHref={cursor === undefined ? null : first}
          />
        </>
      )}
    </div>
  );
};
