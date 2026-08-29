import Link from "next/link";
import { CompassIcon, LinkIcon, SearchXIcon } from "lucide-react";
import { buttonVariants } from "@repo/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import { today } from "#shared/lib";
import { readCataloguePage } from "../api/read-catalogue-page";
import { catalogueHref, readCatalogueSearch } from "../lib/catalogue-search";
import { CatalogueCard } from "./catalogue-card";
import { CatalogueToolbar } from "./catalogue-toolbar";

export const CataloguePage = async ({
  searchParams,
}: PageProps<"/listings">) => {
  const { query, errors, values } = readCatalogueSearch(await searchParams);
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

      {staleCursor && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LinkIcon />
            </EmptyMedia>
            <EmptyTitle>That page is no longer there</EmptyTitle>
            <EmptyDescription>
              The link points at a page this catalogue can no longer find. The
              search itself still works.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link
              href={catalogueHref(values)}
              className={buttonVariants({ variant: "outline" })}
            >
              Start from the first page
            </Link>
          </EmptyContent>
        </Empty>
      )}

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
          <div className="grid gap-4 sm:grid-cols-2">
            {page.items.map((listing) => (
              <CatalogueCard key={listing.id} listing={listing} />
            ))}
          </div>
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

      {/*
        Forwards only, and that is what a keyset cursor is: the pages are ordered by the
        pair the API indexes on, and the next one is asked for by handing back the cursor
        the last one issued. There is no page number to count backwards from — which is
        the point, because a listing published while somebody is paging would shift every
        offset after it. Going back is the browser's Back button, and starting again is
        the same search without a cursor.
      */}
      {page !== null &&
        (page.nextCursor !== null || query?.cursor !== undefined) && (
          <div className="flex items-center gap-2">
            {page.nextCursor !== null && (
              <Link
                href={catalogueHref(values, page.nextCursor)}
                className={buttonVariants({ variant: "outline" })}
              >
                Next page
              </Link>
            )}
            {query?.cursor !== undefined && (
              <Link
                href={catalogueHref(values)}
                className={buttonVariants({ variant: "ghost" })}
              >
                Back to the first page
              </Link>
            )}
          </div>
        )}
    </div>
  );
};
