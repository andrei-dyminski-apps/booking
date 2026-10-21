import { redirect } from "next/navigation";
import { CalendarSearchIcon } from "lucide-react";
import { LookupKind, Role, StayParty } from "@repo/contracts";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import { lookupsApi, requireUser } from "#shared/api";
import { ROUTES } from "#shared/config";
import { lookupOptionText, today } from "#shared/lib";
import {
  ButtonLink,
  NoMatchesNotice,
  PageHeading,
  Pager,
  RefusedSearchNotice,
  StalePageNotice,
} from "#shared/ui";
import { readBookingsPage } from "../api/read-bookings-page";
import {
  activeFilters,
  bookingsHref,
  readBookingsSearch,
  sideOf,
} from "../lib/bookings-search";
import { BookingCard } from "./booking-card";
import { BookingsToolbar } from "./bookings-toolbar";
import { SideTabs } from "./side-tabs";

/**
 * One page, three scopes. `GET /bookings` narrows what it returns by the caller's session
 * rather than by a parameter that could reach past it — a user sees the stays they took or
 * the stays taken against their listings, an admin every one of them. Hosting is not a
 * role, so which half a user is looking at is `?side=HOST`, drawn as the "Trips" and
 * "Hosting" tabs: it picks between two scopes of the caller's own and never widens either.
 * The side decides what to call the list and whether the guest box is worth offering; an
 * admin's scope has no halves and no tabs.
 *
 * What the URL also carries is the filters, the ordering and the cursor of the previous
 * page, exactly as the catalogue's does: the list is a keyset page because one of those
 * scopes has no ceiling on it — an admin's is every stay on the site.
 *
 * The read is personal, so it is `no-store` and carries no tag: the Data Cache is keyed by
 * URL and shared between visitors, and a tag would only make it easier to serve one
 * person's stays to the next.
 */
type Scope = { title: string; empty: string; lead: string };

const SCOPE: Record<StayParty, Scope> = {
  [StayParty.GUEST]: {
    title: "Your trips",
    lead: "Every booking you have taken, with the state the API keeps it in. The filters live in the address bar, so a search is a link you can send.",
    empty: "Nothing booked yet. The catalogue is where a stay starts.",
  },
  [StayParty.HOST]: {
    title: "Hosting",
    lead: "Every stay taken against your listings. Cancelling one is the guest's to do, not yours.",
    empty: "Nobody has booked your listings yet — or you have none on offer.",
  },
};

const ADMIN_SCOPE: Scope = {
  title: "All bookings",
  lead: "Every stay on the site, in the state the API keeps it in — a page at a time, newest first.",
  empty: "There are no bookings at all yet.",
};

export const BookingsPage = async ({
  searchParams,
}: PageProps<"/bookings">) => {
  const viewer = await requireUser(ROUTES.bookings);
  const { query, errors, values, canonical } = readBookingsSearch(
    await searchParams,
  );

  // One search, one address, exactly as the catalogue does it: the dialog is a `GET` form,
  // so it submits every box it has and lands on `?status=CONFIRMED&listingId=&…` — the
  // same search the chips write as `?status=CONFIRMED`. Redirecting before anything is
  // read makes the second of those the only address this list is ever served at. It
  // happens before the API is asked, so the round trip costs a redirect and not a fetch;
  // a refused search is redirected too, because the boxes showing the mistake belong at
  // the address it is going to be corrected at.
  //
  // Temporary rather than permanent on purpose: a 308 is cached by the browser for good,
  // and which addresses this one collapses is a decision of this slice.
  if (canonical !== null) redirect(canonical);

  // The API ignores `side` for an admin, so the page does too.
  const side = viewer.role === Role.ADMIN ? null : sideOf(values);
  const byGuest = side !== StayParty.GUEST;
  // Computed here and handed down rather than read by each card — see `shared/lib/dates.ts`.
  const day = today();
  // A question the contract refuses is not put to the API at all: the messages are under
  // the boxes, and an unfiltered list beside them would read as the answer to it. The names
  // of the rows the filters name are read beside it — the chips read them, and so do the
  // boxes in the dialog, which would otherwise ask again each time it opens. A guest has
  // nobody to look up, so their `?guestId=` stays an id.
  const [page, listing, guest] = await Promise.all([
    query === null ? null : readBookingsPage(query),
    lookupsApi.optionOf(LookupKind.listings, values.listingId, side),
    byGuest
      ? lookupsApi.optionOf(LookupKind.guests, values.guestId)
      : undefined,
  ]);
  const staleCursor = query !== null && page === null;
  const scope = side === null ? ADMIN_SCOPE : SCOPE[side];
  // One read of what is on: the toolbar draws the same list as chips and counts it on the
  // button that opens the dialog, and the empty state asks whether there was a filter to
  // blame for it.
  const filters = activeFilters(values, {
    listing: listing && lookupOptionText(listing),
    guest: guest && lookupOptionText(guest),
  });
  const filtered = filters.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading title={scope.title} description={scope.lead} />

      {side !== null && <SideTabs values={values} />}

      <BookingsToolbar
        values={values}
        errors={errors}
        filters={filters}
        side={side}
        byGuest={byGuest}
        listing={listing}
        guest={guest}
      />

      {staleCursor && <StalePageNotice firstPageHref={bookingsHref(values)} />}

      {page !== null &&
        (page.items.length === 0 ? (
          // An empty answer has two reasons and they read differently: a search nothing
          // matched is a filter away from an answer, and a scope with nothing in it is
          // not — which is what `scope.empty` says, in the words of the role reading it.
          filtered ? (
            <NoMatchesNotice />
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarSearchIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing here yet</EmptyTitle>
                <EmptyDescription>{scope.empty}</EmptyDescription>
              </EmptyHeader>
              {side === StayParty.GUEST && (
                <EmptyContent>
                  <ButtonLink href={ROUTES.catalogue}>
                    Browse the stays
                  </ButtonLink>
                </EmptyContent>
              )}
            </Empty>
          )
        ) : (
          <ul role="list" className="flex flex-col gap-4">
            {page.items.map((booking) => (
              <li key={booking.id}>
                <BookingCard
                  booking={booking}
                  viewer={viewer}
                  side={side}
                  today={day}
                />
              </li>
            ))}
          </ul>
        ))}

      {query === null && <RefusedSearchNotice />}

      {page !== null && (
        <Pager
          nextHref={
            page.nextCursor !== null
              ? bookingsHref(values, page.nextCursor)
              : null
          }
          firstHref={query?.cursor !== undefined ? bookingsHref(values) : null}
        />
      )}
    </div>
  );
};
