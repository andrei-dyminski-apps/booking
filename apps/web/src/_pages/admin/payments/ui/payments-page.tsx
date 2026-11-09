import { redirect } from "next/navigation";
import { CircleCheckIcon } from "lucide-react";
import { LookupKind, RefundFailureStatus, Role } from "@repo/contracts";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import { lookupsApi, requireRole } from "#shared/api";
import {
  ROUTES,
  setAsideHref,
  type SetAsideFilterKey,
  type SetAsideList,
} from "#shared/config";
import { lookupOptionText } from "#shared/lib";
import {
  ButtonLink,
  NoMatchesNotice,
  PageHeading,
  Pager,
  RefusedSearchNotice,
  StalePageNotice,
} from "#shared/ui";
import { readSetAsidePage, type SetAsidePage } from "../api/read-set-aside";
import {
  activeFilters,
  firstPageHref,
  nextPageHref,
  readPaymentsSearch,
  viewHref,
  type ActiveFilter,
  type SetAsideView,
} from "../lib/payments-search";
import { FailedEventCard } from "./failed-event-card";
import { ListTabs, StatusTabs } from "./list-tabs";
import { PaymentsToolbar } from "./payments-toolbar";
import { RefundFailureCard } from "./refund-failure-card";
import { StuckStayCard } from "./stuck-stay-card";

/** What each list is, said once under the tabs. */
const DESCRIPTIONS: Record<SetAsideView["list"], string> = {
  events:
    "Payment provider events the worker gave up on. Deploy the fix first, then retry: the handlers are safe to run again.",
  bounced:
    "Refunds the guest's bank sent back. The same card refuses them again, so the money goes back another way — record how.",
  "stuck-refunds":
    "Refunds owed to guests — for a cancelled stay, or for the unused nights of one ended early — that stopped retrying. Retrying sends what the stay still owes.",
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
  const search = readPaymentsSearch(await searchParams);
  const { list, values, errors, view, canonical } = search;

  // Back to the very tab, filters and page after a sign-in, as the admin's listings come
  // back with theirs: a notice links straight to its row. The view's own address, which is
  // also where `canonical` would send it.
  await requireRole(Role.ADMIN, viewHref(search));

  // One view, one address — see `canonical` in `bookings-search.ts`.
  if (canonical !== null) redirect(canonical);

  // A question the contract refuses is not put to the API at all. The names of the rows the
  // id filters name are read beside the list — the chips read them, and so do the boxes.
  const [result, listing, guest, host] = await Promise.all([
    view === null ? null : readSetAsidePage(view),
    lookupsApi.optionOf(LookupKind.listings, values.listingId),
    lookupsApi.optionOf(LookupKind.guests, values.guestId),
    lookupsApi.optionOf(LookupKind.hosts, values.hostId),
  ]);
  const filters = activeFilters(list, values, {
    listing: listing && lookupOptionText(listing),
    guest: guest && lookupOptionText(guest),
    host: host && lookupOptionText(host),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Payments"
        description="Money that waits for a person: what the background jobs gave up on, newest first."
      />

      <div className="flex flex-col gap-3">
        <ListTabs current={list} />
        <p className="text-sm text-muted-foreground">{DESCRIPTIONS[list]}</p>
        {list === "bounced" && <StatusTabs values={values} />}
      </div>

      <PaymentsToolbar
        list={list}
        values={values}
        errors={errors}
        filters={filters}
        listing={listing}
        guest={guest}
        host={host}
      />

      {view === null ? (
        <RefusedSearchNotice />
      ) : result === null ? (
        <StalePageNotice firstPageHref={firstPageHref(search)} />
      ) : (
        <>
          <SetAsideItems result={result} view={view} filters={filters} />
          <Pager
            nextHref={
              result.page.nextCursor !== null
                ? nextPageHref(search, result.page.nextCursor)
                : null
            }
            firstHref={
              search.cursor !== undefined ? firstPageHref(search) : null
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
  filters,
}: {
  result: SetAsidePage;
  view: SetAsideView;
  filters: ActiveFilter[];
}) => {
  if (result.page.items.length === 0) {
    if (filters.length === 0) {
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

    const [only, ...others] = filters;

    return others.length === 0 && only?.key === namedRowKey(view.list) ? (
      <NoLongerWaitingNotice view={view} />
    ) : (
      <NoMatchesNotice />
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

/** The filter an admin notice opens its tab with: the id of the one row it is about. */
function namedRowKey(list: SetAsideList): SetAsideFilterKey {
  switch (list) {
    case "events":
      return "eventId";
    case "bounced":
      return "refundId";
    case "stuck-refunds":
    case "stuck-payouts":
      return "bookingId";
  }
}

/**
 * The one row a notice named, gone from the tab the notice opens filtered down to it —
 * somebody dealt with it between the notice and the click. Said as that rather than as a
 * search that found nothing, with where the row is now. Worded as an "if": the same address
 * is reached by an id typed into the box, which may name no row at all.
 */
const NoLongerWaitingNotice = ({ view }: { view: SetAsideView }) => {
  const { title, description, link } = noLongerWaiting(view);

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleCheckIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {link !== null && (
        <EmptyContent>
          <ButtonLink href={link.href} variant="outline" size="sm">
            {link.label}
          </ButtonLink>
        </EmptyContent>
      )}
    </Empty>
  );
};

function noLongerWaiting(view: SetAsideView): {
  title: string;
  description: string;
  link: { href: string; label: string } | null;
} {
  switch (view.list) {
    case "events":
      return {
        title: "This event is no longer set aside",
        description:
          "If a notice named it, it was retried since and has gone through or is back with the worker — a run that fails again sets it aside here once more.",
        link: null,
      };
    case "bounced": {
      const { refundId, status } = view.query;

      return status === RefundFailureStatus.OPEN
        ? {
            title: "This refund is not open",
            description:
              "If a notice named it, it was resolved since, and the resolved ones keep how the money went back.",
            link: {
              href: setAsideHref("bounced", {
                refundId,
                status: RefundFailureStatus.RESOLVED,
              }),
              label: "Look among the resolved",
            },
          }
        : {
            title: "This refund is not resolved",
            description:
              "If a notice named it, it is still waiting for a person among the open ones.",
            link: {
              href: setAsideHref("bounced", { refundId }),
              label: "Look among the open",
            },
          };
    }
    case "stuck-refunds":
    case "stuck-payouts": {
      const { bookingId } = view.query;

      return {
        title:
          view.list === "stuck-refunds"
            ? "This stay's refund is no longer stuck"
            : "This stay's payout is no longer stuck",
        description:
          "If a notice named it, it has left the list since — retried and sent or on its way, or nothing is owed any more. The stay shows where its money stands.",
        link:
          bookingId === undefined
            ? null
            : { href: ROUTES.booking(bookingId), label: "Open the stay" },
      };
    }
  }
}
