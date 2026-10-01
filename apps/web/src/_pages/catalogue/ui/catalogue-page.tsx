import { redirect } from "next/navigation";
import { WarehouseIcon } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import { today } from "#shared/lib";
import {
  NoMatchesNotice,
  Pager,
  RefusedSearchNotice,
  StalePageNotice,
} from "#shared/ui";
import { readCataloguePage } from "../api/read-catalogue-page";
import {
  activeFilters,
  catalogueHref,
  readCatalogueSearch,
} from "../lib/catalogue-search";
import { CatalogueCard } from "./catalogue-card";
import { CatalogueToolbar } from "./catalogue-toolbar";

export const CataloguePage = async ({
  searchParams,
}: PageProps<"/listings">) => {
  const { query, errors, values, canonical } = readCatalogueSearch(
    await searchParams,
  );

  // One search, one address. The dialog is a `GET` form, so it submits every box it has
  // and lands on `?from=&to=&minPrice=100&…` — the same search the chips write as
  // `?minPrice=100`. Redirecting before anything is read makes the second of those the
  // only address the catalogue is ever served at, and it does the same for a link
  // somebody wrote by hand. It happens before the API is asked, so the round trip costs
  // a redirect and not a fetch; a refused search is redirected too, because the boxes
  // showing the mistake belong at the address it is going to be corrected at.
  //
  // Temporary rather than permanent on purpose: a 308 is cached by the browser for good,
  // and which addresses this one collapses is a decision of this slice rather than a
  // property of the URL.
  if (canonical !== null) redirect(canonical);

  // A question the contract refuses is not put to the API at all: the messages are under
  // the boxes, and an unfiltered list beside them would read as the answer to it.
  const page = query === null ? null : await readCataloguePage(query);
  const staleCursor = query !== null && page === null;
  // One read of what is on: the toolbar draws the same list as chips and counts it on the
  // button that opens the dialog, and the empty state asks whether there was a filter to
  // blame for it.
  const filters = activeFilters(values);
  const filtered = filters.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Stays</h1>
        <p className="text-sm text-muted-foreground">
          Every listing on offer. The filters live in the address bar, so a
          search is a link you can send.
        </p>
      </div>

      <CatalogueToolbar
        values={values}
        errors={errors}
        filters={filters}
        earliest={today()}
      />

      {staleCursor && <StalePageNotice firstPageHref={catalogueHref(values)} />}

      {page !== null &&
        (page.items.length === 0 ? (
          // An empty answer has two reasons and they read differently: a search nothing
          // matched is a filter away from an answer, and a catalogue with nothing in it is
          // not.
          filtered ? (
            <NoMatchesNotice />
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <WarehouseIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing on offer yet</EmptyTitle>
                <EmptyDescription>
                  No listing has been published. The first one an owner puts up
                  will be here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        ) : (
          <ul role="list" className="grid gap-4 sm:grid-cols-2">
            {page.items.map((listing) => (
              <li key={listing.id}>
                <CatalogueCard listing={listing} />
              </li>
            ))}
          </ul>
        ))}

      {query === null && <RefusedSearchNotice />}

      {page !== null && (
        <Pager
          nextHref={
            page.nextCursor !== null
              ? catalogueHref(values, page.nextCursor)
              : null
          }
          firstHref={query?.cursor !== undefined ? catalogueHref(values) : null}
        />
      )}
    </div>
  );
};
