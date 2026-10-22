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
 * What the boxes of the filter form hold — the catalogue's set (`features/listing-search`) plus
 * `ownerId`, which the catalogue's contract already takes and only this screen has a use
 * for. It comes first, so it is the first parameter of every link this slice writes.
 */
export type FilterValues = { ownerId: string } & ListingFilterValues;

export type ListingsSearch = {
  /** The question to put to the API, or `null` when the URL holds one it cannot answer. */
  query: ListingQuery | null;
  /**
   * The owner to name on the screen, whenever the URL carries an id that parses — read
   * apart from `query`, so a refusal of some other filter does not take away whose
   * listings these are.
   */
  ownerId: string | null;
  errors: FieldErrors;
  values: FilterValues;
  /** The address this search belongs at, or `null` when the URL already spells it. */
  canonical: string | null;
};

/**
 * The filters of the admin's listings as they arrive: untrusted text, parsed by the schema
 * that validates the same query string in Nest, with what it refuses shown under the box
 * it belongs to. One search, one address — the rule every other list keeps, and for the
 * same reason: the dialog is a `GET` form and submits every box it has.
 */
export function readListingsSearch(
  params: Record<string, string | string[] | undefined>,
): ListingsSearch {
  const values: FilterValues = {
    ownerId: singleParam(params.ownerId),
    from: singleParam(params.from),
    to: singleParam(params.to),
    minPrice: singleParam(params.minPrice),
    maxPrice: singleParam(params.maxPrice),
    guests: singleParam(params.guests),
    sort: singleParam(params.sort),
  };

  const cursor = singleParam(params.cursor);
  const parsed = listingQuerySchema.safeParse({ ...values, cursor });
  const owner = listingQuerySchema.shape.ownerId.safeParse(values.ownerId);
  const ownerId = owner.success ? (owner.data ?? null) : null;

  const href = listingsHref(values, cursor === "" ? undefined : cursor);
  const canonical =
    href === searchParamsHref(ROUTES.admin, params) ? null : href;

  return parsed.success
    ? { query: parsed.data, ownerId, errors: {}, values, canonical }
    : {
        query: null,
        ownerId,
        errors: toFieldErrors(parsed.error.issues),
        values,
        canonical,
      };
}

/** A link to the admin's listings carrying these filters, and the next page when a cursor is handed over. */
export function listingsHref(values: FilterValues, cursor?: string): string {
  return filtersHref(ROUTES.admin, values, cursor);
}

/** The orderings the contract offers, each a link to this same search under it. */
export function sortOptions(values: FilterValues): SortOption[] {
  return listingSortOptions(values, listingsHref);
}

/** The same ordering with nothing filtered — an ordering is not a filter. */
export function clearedFiltersHref(values: FilterValues): string {
  return listingsHref({ ...withoutListingFilters(values), ownerId: "" });
}

/** A filter as a chip: what it says, and the link that takes it off. */
export type ActiveFilter = FilterChip;

/**
 * What is currently being filtered by, as chips: the owner first, then the catalogue's
 * own (`listingFilterChips`). The owner is named by their name and address where the page
 * could resolve the id, and by a shortened id where it could not — a value the contract refused
 * is shown as it was typed, so that it can be taken off.
 */
export function activeFilters(
  values: FilterValues,
  names: { owner?: string | undefined } = {},
): ActiveFilter[] {
  const owner: ActiveFilter[] =
    values.ownerId === ""
      ? []
      : [
          {
            key: "ownerId",
            label: `Owner ${names.owner ?? shortId(values.ownerId)}`,
            href: listingsHref({ ...values, ownerId: "" }),
          },
        ];

  return [...owner, ...listingFilterChips(values, listingsHref)];
}

/** The first block of a uuid — enough to tell two apart on a chip. */
function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
