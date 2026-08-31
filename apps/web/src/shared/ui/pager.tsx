import { ButtonLink } from "./button-link";

/**
 * Forwards-only keyset paging, drawn once for the two lists that page. The links are
 * written by the slice that knows what is paged (`catalogueHref` / `bookingsHref`); this
 * only decides which of the two to show.
 *
 * There is no page number to count back from — which is the point, because a row inserted
 * while somebody is paging would shift every offset after it. Going back is the browser's
 * Back button, and starting again is the same search without a cursor.
 *
 * Navigating is the whole of what it does, like `SortSelect` beside it, so it is a
 * `shared/ui` component rather than a primitive of the design system. Both links are plain
 * anchors, so it needs no `"use client"`.
 */
export const Pager = ({
  nextHref,
  firstHref,
}: {
  /** The next page, carrying the cursor the last one issued — or `null` at the end. */
  nextHref: string | null;
  /** The same search with no cursor — or `null` when this already is the first page. */
  firstHref: string | null;
}) => {
  if (nextHref === null && firstHref === null) return null;

  return (
    <div className="flex items-center gap-2">
      {nextHref !== null && (
        <ButtonLink href={nextHref} variant="outline">
          Next page
        </ButtonLink>
      )}
      {firstHref !== null && (
        <ButtonLink href={firstHref} variant="ghost">
          Back to the first page
        </ButtonLink>
      )}
    </div>
  );
};
