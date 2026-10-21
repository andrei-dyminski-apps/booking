import type { LookupOption, LookupPage } from "@repo/contracts";

/** The answer to one search, tagged with what was searched so a stale one is never shown. */
export type LookupSearch =
  | { term: string; status: "failed" }
  | {
      term: string;
      status: "done";
      items: LookupOption[];
      nextCursor: string | null;
      loadingMore: boolean;
    };

/** The first page of a search, which replaces whatever the box showed before. */
export function firstPage(term: string, page: LookupPage): LookupSearch {
  return {
    term,
    status: "done",
    items: page.items,
    nextCursor: page.nextCursor,
    loadingMore: false,
  };
}

/**
 * The page after `cursor`, appended to whatever the search is by the time it lands — and
 * only while that search still ends at this cursor: a fresh first page of the same term
 * may have replaced it meanwhile, and appending to that would repeat or skip rows.
 */
export function withNextPage(
  previous: LookupSearch | null,
  term: string,
  cursor: string,
  page: LookupPage,
): LookupSearch | null {
  return previous?.status === "done" &&
    previous.term === term &&
    previous.nextCursor === cursor
    ? {
        ...previous,
        items: [...previous.items, ...page.items],
        nextCursor: page.nextCursor,
        loadingMore: false,
      }
    : previous;
}

/**
 * A next page that never came, aborted or failed. The cursor stays where it was, so
 * scrolling again asks again.
 */
export function withoutNextPage(
  previous: LookupSearch | null,
  term: string,
): LookupSearch | null {
  return previous?.status === "done" && previous.term === term
    ? { ...previous, loadingMore: false }
    : previous;
}
