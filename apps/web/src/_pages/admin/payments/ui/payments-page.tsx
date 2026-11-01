import { redirect } from "next/navigation";
import { CircleCheckIcon } from "lucide-react";
import { RefundFailureStatus, Role } from "@repo/contracts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import { requireRole } from "#shared/api";
import { PageHeading, Pager, StalePageNotice } from "#shared/ui";
import { readSetAsidePage, type SetAsidePage } from "../api/read-set-aside";
import {
  firstPageHref,
  nextPageHref,
  readPaymentsSearch,
  viewHref,
  type SetAsideView,
} from "../lib/payments-search";
import { FailedEventCard } from "./failed-event-card";
import { ListTabs, StatusTabs } from "./list-tabs";
import { RefundFailureCard } from "./refund-failure-card";
import { StuckStayCard } from "./stuck-stay-card";

/** What each list is, said once under the tabs. */
const DESCRIPTIONS: Record<SetAsideView["list"], string> = {
  events:
    "Payment provider events the worker gave up on. Deploy the fix first, then retry: the handlers are safe to run again.",
  bounced:
    "Refunds the guest's bank sent back. The same card refuses them again, so the money goes back another way — record how.",
  "stuck-refunds":
    "Refunds owed for cancelled stays that stopped retrying. Retrying sends what the stay still owes.",
  "stuck-payouts":
    "Host payouts that stopped retrying. Retrying sends the host's share again.",
};

/**
 * What the money paths set aside for a person, and what an admin does about each of it —
 * the screen the four admin notices lead to. Each tab is its own list of the API, newest
 * first and paged forwards; every read is `no-store`, and every action re-renders the page
 * without the row it handled.
 */
export const PaymentsPage = async ({
  searchParams,
}: PageProps<"/admin/payments">) => {
  const { view, canonical } = readPaymentsSearch(await searchParams);

  // Back to the very tab and page after a sign-in, as the admin's listings come back with
  // their filters: a notice links straight to a tab. The view's own address, which is also
  // where `canonical` would send it.
  await requireRole(Role.ADMIN, viewHref(view));

  // One view, one address — see `canonical` in `bookings-search.ts`.
  if (canonical !== null) redirect(canonical);

  const result = await readSetAsidePage(view);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Payments"
        description="Money that waits for a person: what the background jobs gave up on, newest first."
      />

      <div className="flex flex-col gap-3">
        <ListTabs current={view.list} />
        <p className="text-sm text-muted-foreground">
          {DESCRIPTIONS[view.list]}
        </p>
        {view.list === "bounced" && <StatusTabs current={view.query.status} />}
      </div>

      {result === null ? (
        <StalePageNotice firstPageHref={firstPageHref(view)} />
      ) : (
        <>
          <SetAsideItems result={result} view={view} />
          <Pager
            nextHref={
              result.page.nextCursor !== null
                ? nextPageHref(view, result.page.nextCursor)
                : null
            }
            firstHref={
              view.query.cursor !== undefined ? firstPageHref(view) : null
            }
          />
        </>
      )}
    </div>
  );
};

const SetAsideItems = ({
  result,
  view,
}: {
  result: SetAsidePage;
  view: SetAsideView;
}) => {
  if (result.page.items.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleCheckIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing here</EmptyTitle>
          <EmptyDescription>{emptyDescription(view)}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  switch (result.list) {
    case "events":
      return (
        <ul role="list" className="flex flex-col gap-4">
          {result.page.items.map((event) => (
            <li key={event.id}>
              <FailedEventCard event={event} />
            </li>
          ))}
        </ul>
      );
    case "bounced":
      return (
        <ul role="list" className="flex flex-col gap-4">
          {result.page.items.map((failure) => (
            <li key={failure.refundId}>
              <RefundFailureCard failure={failure} />
            </li>
          ))}
        </ul>
      );
    case "stuck-refunds":
    case "stuck-payouts":
      return (
        <ul role="list" className="flex flex-col gap-4">
          {result.page.items.map((stuck) => (
            <li key={stuck.booking.id}>
              <StuckStayCard stuck={stuck} />
            </li>
          ))}
        </ul>
      );
  }
};

/** What an empty list says — good news for every one of them but the resolved record. */
function emptyDescription(view: SetAsideView): string {
  switch (view.list) {
    case "events":
      return "No payment event is waiting for a person.";
    case "bounced":
      return view.query.status === RefundFailureStatus.RESOLVED
        ? "No bounced refund has been resolved yet."
        : "No bounced refund is waiting for a person.";
    case "stuck-refunds":
      return "No owed refund is stuck.";
    case "stuck-payouts":
      return "No host payout is stuck.";
  }
}
