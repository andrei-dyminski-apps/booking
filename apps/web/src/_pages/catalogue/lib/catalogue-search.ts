import { listingQuerySchema, type ListingQuery } from "@repo/contracts";
import {
  listingFilterChips,
  listingSortOptions,
  withoutListingFilters,
  type ListingFilterValues,
} from "#features/listing-search";
import { ROUTES } from "#shared/config";
import {
  filtersHref,
  searchParamsHref,
  singleParam,
  toFieldErrors,
  type FieldErrors,
} from "#shared/lib";
import type { FilterChip, SortOption } from "#shared/ui";

/**
 * What the boxes of the filter form hold — the set `features/listing-search` describes, because
 * the admin's listings put the same question to the same contract.
 */
export type FilterValues = ListingFilterValues;

export type CatalogueSearch = {
  /**
   * The question to put to the API, or `null` when what arrived in the URL is not one it
   * can answer. Half a date range is the case that happens in practice — the form lets a
   * visitor fill one box and leave the other — and the honest answer to it is the message
   * the contract already writes, not the unfiltered catalogue somebody would mistake for
   * a result.
   */
  query: ListingQuery | null;
  errors: FieldErrors;
  values: FilterValues;
  /**
   * The address this search belongs at, or `null` when the URL already spells it. A
   * `GET` form submits every box it has, so the ordinary way to arrive here is
   * `?from=&to=&minPrice=100&…` — the same search the chips and the ordering write as
   * `?minPrice=100`. Both are answered identically, and that is the problem: one
   * catalogue under two addresses is a link that is longer than the search it carries,
   * a second entry in the router cache for a page already there, and two URLs for a
   * crawler to read as duplicates. So the page redirects to this one instead of
   * rendering, and every address of the catalogue is a link this slice would have
   * written itself.
   */
  canonical: string | null;
};

/**
 * The catalogue's filters as they arrive: `searchParams` is untrusted text, so the same
 * schema that validates the query string on the API side parses it here, and what it
 * refuses is shown under the box it belongs to.
 *
 * An empty box is not a filter, and the contract is what says so: `listingQuerySchema`
 * reads each blank as the absence it means, on this side and on the API's, so a search is
 * answered the same however many empty boxes the form submitted along with it. What the
 * blanks do not survive is the address bar — see `canonical`.
 */
export function readCatalogueSearch(
  params: Record<string, string | string[] | undefined>,
): CatalogueSearch {
  const values: FilterValues = {
    from: singleParam(params.from),
    to: singleParam(params.to),
    minPrice: singleParam(params.minPrice),
    maxPrice: singleParam(params.maxPrice),
    guests: singleParam(params.guests),
    sort: singleParam(params.sort),
  };

  const cursor = singleParam(params.cursor);
  const parsed = listingQuerySchema.safeParse({ ...values, cursor });

  const href = catalogueHref(values, cursor === "" ? undefined : cursor);
  const canonical =
    href === searchParamsHref(ROUTES.catalogue, params) ? null : href;

  return parsed.success
    ? { query: parsed.data, errors: {}, values, canonical }
    : {
        query: null,
        errors: toFieldErrors(parsed.error.issues),
        values,
        canonical,
      };
}

/**
 * A link to the catalogue carrying these filters, and the next page of them when a cursor
 * is handed over. `filtersHref` does the assembling; what stays here is the route and the
 * field order every link of this slice shares. The cursor is deliberately not part of the
 * filter form: changing what is being searched for starts the pages again, and a cursor
 * left over from the previous question would answer a different one — the ordering is the
 * same thing said more strictly, since the API refuses a cursor against another ordering,
 * and every link below is written without one for that reason.
 */
export function catalogueHref(values: FilterValues, cursor?: string): string {
  return filtersHref(ROUTES.catalogue, values, cursor);
}

/**
 * The orderings the contract offers, each of them a link to this same search under it.
 *
 * An address rather than a value submitted somewhere: the ordering lives in the address
 * bar like every filter, so switching it survives a reload and is undone by the browser's
 * Back button — the select in the toolbar navigates to the link of the option it was
 * given. The default leaves no trace in the URL — a catalogue ordered by what has just
 * appeared is the bare `/listings`.
 */
export function sortOptions(values: FilterValues): SortOption[] {
  return listingSortOptions(values, catalogueHref);
}

/**
 * The same ordering with nothing filtered, for the "Clear all" of the chips and of the
 * dialog. An ordering is not a filter — there is no unordered catalogue to fall back to —
 * so clearing the filters leaves it where the visitor put it.
 */
export function clearedFiltersHref(values: FilterValues): string {
  return catalogueHref(withoutListingFilters(values));
}

/**
 * A filter as a chip: what it says, and the link that takes it off. Removing one is a
 * link rather than a button for the same reason searching is a `GET` form — the filters
 * live in the address bar, so taking one away is another address, and it needs neither
 * JavaScript nor a round trip through an action to be spelled. The link is written
 * without a cursor, see `catalogueHref`.
 */
export type ActiveFilter = FilterChip;

/**
 * What this visitor is currently filtering by, as chips — the dates as one, the reason
 * and the labels are in `listingFilterChips`.
 */
export function activeFilters(values: FilterValues): ActiveFilter[] {
  return listingFilterChips(values, catalogueHref);
}
