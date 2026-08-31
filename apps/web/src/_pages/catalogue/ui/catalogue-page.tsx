import { redirect } from "next/navigation";
import { CompassIcon, SearchXIcon } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import { today } from "#shared/lib";
import { Pager, StalePageNotice } from "#shared/ui";
import { readCataloguePage } from "../api/read-catalogue-page";
import { catalogueHref, readCatalogueSearch } from "../lib/catalogue-search";
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Stays</h1>
        <p className="text-sm text-muted-foreground">
          Every listing on offer. The filters live in the address bar, so a
          search is a link you can send.
        </p>
      </div>

      <CatalogueToolbar values={values} errors={errors} earliest={today()} />

      {staleCursor && <StalePageNotice firstPageHref={catalogueHref(values)} />}

      {page !== null &&
        (page.items.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing matches this search</EmptyTitle>
              <EmptyDescription>
                Try a wider window, a higher price, or fewer guests — the chips
                above take a filter off one at a time.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul role="list" className="grid gap-4 sm:grid-cols-2">
            {page.items.map((listing) => (
              <li key={listing.id}>
                <CatalogueCard listing={listing} />
              </li>
            ))}
          </ul>
        ))}

      {query === null && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CompassIcon />
            </EmptyMedia>
            <EmptyTitle>This search cannot be answered</EmptyTitle>
            <EmptyDescription>
              The messages above say what is wrong with it. Nothing was asked of
              the API — a list beside them would read as the answer.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

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
