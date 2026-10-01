import { redirect } from "next/navigation";
import { CalendarSearchIcon } from "lucide-react";
import { Role, type Role as RoleName } from "@repo/contracts";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import { requireUser } from "#shared/api";
import { ROUTES } from "#shared/config";
import {
  ButtonLink,
  NoMatchesNotice,
  Pager,
  RefusedSearchNotice,
  StalePageNotice,
} from "#shared/ui";
import { readBookingsPage } from "../api/read-bookings-page";
import {
  activeFilters,
  bookingsHref,
  readBookingsSearch,
} from "../lib/bookings-search";
import { BookingCard } from "./booking-card";
import { BookingsToolbar } from "./bookings-toolbar";

/**
 * One page, three scopes. `GET /bookings` narrows what it returns by the caller's role
 * rather than by a parameter — a guest sees the stays they took, an owner the stays taken
 * against their listings, an admin every one of them — so this page has no scope to get
 * wrong, and the only thing the role decides here is what to call the list and whether the
 * guest box is worth offering.
 *
 * What the URL does carry is the filters, the ordering and the cursor of the previous
 * page, exactly as the catalogue's does: the list is a keyset page because one of those
 * three scopes has no ceiling on it — an admin's is every stay on the site.
 *
 * The read is personal, so it is `no-store` and carries no tag: the Data Cache is keyed by
 * URL and shared between visitors, and a tag would only make it easier to serve one
 * person's stays to the next.
 */
const SCOPE: Record<RoleName, { title: string; empty: string; lead: string }> =
  {
    [Role.USER]: {
      title: "Your stays",
      lead: "Every booking you have taken, with the state the API keeps it in. The filters live in the address bar, so a search is a link you can send.",
      empty: "Nothing booked yet. The catalogue is where a stay starts.",
    },
    [Role.OWNER]: {
      title: "Bookings",
      lead: "Every stay taken against your listings. Cancelling one is the guest's to do, not yours.",
      empty: "Nobody has booked your listings yet.",
    },
    [Role.ADMIN]: {
      title: "All bookings",
      lead: "Every stay on the site, in the state the API keeps it in — a page at a time, newest first.",
      empty: "There are no bookings at all yet.",
    },
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

  // A question the contract refuses is not put to the API at all: the messages are under
  // the boxes, and an unfiltered list beside them would read as the answer to it.
  const page = query === null ? null : await readBookingsPage(query);
  const staleCursor = query !== null && page === null;
  const scope = SCOPE[viewer.role];
  // One read of what is on: the toolbar draws the same list as chips and counts it on the
  // button that opens the dialog, and the empty state asks whether there was a filter to
  // blame for it.
  const filters = activeFilters(values, {
    // The name of the listing being filtered by, where a row on this page carries one.
    listing: page?.items.find((stay) => stay.listingId === values.listingId)
      ?.listing.title,
  });
  const filtered = filters.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{scope.title}</h1>
        <p className="text-sm text-muted-foreground">{scope.lead}</p>
      </div>

      <BookingsToolbar
        values={values}
        errors={errors}
        filters={filters}
        byGuest={viewer.role !== Role.USER}
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
              {viewer.role === Role.USER && (
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
                <BookingCard booking={booking} viewer={viewer} />
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
