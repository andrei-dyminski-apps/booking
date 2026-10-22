import { HourglassIcon } from "lucide-react";
import {
  MAX_WAITLIST_ENTRIES,
  Role,
  StayParty,
  type WaitlistDemandQuery,
} from "@repo/contracts";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import { requireUser, waitlistApi } from "#shared/api";
import { ROUTES } from "#shared/config";
import type { FieldErrors } from "#shared/lib";
import {
  ButtonLink,
  PageHeading,
  Pager,
  RefusedSearchNotice,
  SortSelect,
  StalePageNotice,
} from "#shared/ui";
import { readDemandPage } from "../api/read-demand-page";
import {
  readWaitlistSearch,
  sideOf,
  sortOptions,
  waitlistHref,
  type WaitlistValues,
} from "../lib/waitlist-search";
import { DemandEntries } from "./demand-entries";
import { OwnEntries } from "./own-entries";
import { SideTabs } from "./side-tabs";

/**
 * One page, three scopes, the way `/bookings` is one: a user sees the ranges they wait for
 * or the ones waited for on their listings (`?side=HOST`), an admin every range on the
 * site. The scope is the session's on the API side, so `side` only picks which of a
 * user's two lists is drawn. The two read differently — the caller's own is answered
 * whole, the other is a keyset page — which is why each side is its own component.
 */
type Scope = { title: string; lead: string; empty: string };

const SCOPE: Record<StayParty, Scope> = {
  [StayParty.GUEST]: {
    title: "Your waitlist",
    lead: `Nights somebody else holds. You get a notification when they come free, and whoever books first takes them. Up to ${String(MAX_WAITLIST_ENTRIES)} at a time.`,
    empty:
      "You are not waiting for any nights. Pick taken dates on a listing to join.",
  },
  [StayParty.HOST]: {
    title: "Waitlist on your listings",
    lead: "Nights guests want on your listings and could not take. Who waits stays theirs to say until they book.",
    empty: "Nobody is waiting for nights on your listings.",
  },
};

const ADMIN_SCOPE: Scope = {
  title: "Every waitlist",
  lead: "Every range waited for on the site, and who waits for it.",
  empty: "Nobody is waiting for any nights.",
};

export const WaitlistPage = async ({
  searchParams,
}: PageProps<"/waitlist">) => {
  const viewer = await requireUser(ROUTES.waitlist);
  const { values, query, errors } = readWaitlistSearch(await searchParams);
  // An admin waits for nothing — the API refuses them the list — so theirs has no sides.
  const side = viewer.role === Role.ADMIN ? null : sideOf(values);
  const scope = side === null ? ADMIN_SCOPE : SCOPE[side];

  return (
    <div className="flex flex-col gap-6">
      <PageHeading title={scope.title} description={scope.lead} />

      {side !== null && <SideTabs values={values} />}

      {side === StayParty.GUEST ? (
        <OwnSide empty={scope.empty} />
      ) : (
        <DemandSide
          values={values}
          query={query}
          errors={errors}
          empty={scope.empty}
        />
      )}
    </div>
  );
};

const OwnSide = async ({ empty }: { empty: string }) => {
  const entries = await waitlistApi.mine();

  return entries.length === 0 ? (
    <NothingWaited description={empty} browse />
  ) : (
    <OwnEntries entries={entries} />
  );
};

const DemandSide = async ({
  values,
  query,
  errors,
  empty,
}: {
  values: WaitlistValues;
  query: WaitlistDemandQuery | null;
  errors: FieldErrors;
  empty: string;
}) => {
  const page = query === null ? null : await readDemandPage(query);
  const staleCursor = query !== null && page === null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SortSelect options={sortOptions(values)} error={errors.sort} />
      </div>

      {staleCursor && <StalePageNotice firstPageHref={waitlistHref(values)} />}

      {page !== null &&
        (page.items.length === 0 ? (
          <NothingWaited description={empty} />
        ) : (
          <DemandEntries entries={page.items} />
        ))}

      {query === null && <RefusedSearchNotice />}

      {page !== null && (
        <Pager
          nextHref={
            page.nextCursor !== null
              ? waitlistHref(values, page.nextCursor)
              : null
          }
          firstHref={query?.cursor !== undefined ? waitlistHref(values) : null}
        />
      )}
    </>
  );
};

const NothingWaited = ({
  description,
  browse = false,
}: {
  description: string;
  browse?: boolean;
}) => (
  <Empty className="border">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <HourglassIcon />
      </EmptyMedia>
      <EmptyTitle>Nothing here yet</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
    {browse && (
      <EmptyContent>
        <ButtonLink href={ROUTES.catalogue}>Browse the stays</ButtonLink>
      </EmptyContent>
    )}
  </Empty>
);
