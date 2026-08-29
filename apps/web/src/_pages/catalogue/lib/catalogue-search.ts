import {
  listingQuerySchema,
  listingSortSchema,
  type ListingQuery,
  type ListingSort,
} from "@repo/contracts";
import { ROUTES } from "#shared/config";
import {
  formatDay,
  formatMoney,
  isDay,
  toFieldErrors,
  type FieldErrors,
} from "#shared/lib";

/**
 * What the boxes of the filter form hold — text, because that is what a URL carries.
 *
 * `sort` travels with them although it is not a filter: it is a value of the same URL, so
 * every link this file writes has to carry it or a chip would silently reorder the list.
 */
export type FilterValues = {
  from: string;
  to: string;
  minPrice: string;
  maxPrice: string;
  guests: string;
  sort: string;
};

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
};

/**
 * The catalogue's filters as they arrive: `searchParams` is untrusted text, so the same
 * schema that validates the query string on the API side parses it here, and what it
 * refuses is shown under the box it belongs to.
 *
 * An empty box is not a filter, and nothing here has to say so: a `GET` form submits every
 * field it has, so the URL of an unfiltered search spells out `?from=&to=&…`, and
 * `listingQuerySchema` reads each blank as the absence it means. That rule lives in the
 * contract rather than here precisely because both sides meet it — the query string the
 * API parses arrives with the same blanks in it.
 */
export function readCatalogueSearch(
  params: Record<string, string | string[] | undefined>,
): CatalogueSearch {
  const values: FilterValues = {
    from: single(params.from),
    to: single(params.to),
    minPrice: single(params.minPrice),
    maxPrice: single(params.maxPrice),
    guests: single(params.guests),
    sort: single(params.sort),
  };

  const parsed = listingQuerySchema.safeParse({
    ...values,
    cursor: single(params.cursor),
  });

  return parsed.success
    ? { query: parsed.data, errors: {}, values }
    : { query: null, errors: toFieldErrors(parsed.error.issues), values };
}

/**
 * A link to the catalogue carrying these filters, and the next page of them when a cursor
 * is handed over. The cursor is deliberately not part of the filter form: changing what
 * is being searched for starts the pages again, and a cursor left over from the previous
 * question would answer a different one. Changing the ordering is the same thing said
 * more strictly — a cursor names a place in one ordering and the API refuses it against
 * another — and every link below is written without one for exactly that reason.
 */
export function catalogueHref(values: FilterValues, cursor?: string): string {
  const search = new URLSearchParams(withoutEmpty(values));

  if (cursor !== undefined) search.set("cursor", cursor);

  const query = search.toString();

  return query === "" ? ROUTES.catalogue : `${ROUTES.catalogue}?${query}`;
}

/**
 * How each ordering reads on the screen. The names of the contract say what is compared
 * and in which direction; these say what a visitor is choosing between.
 */
const SORT_LABELS: Record<ListingSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  priceAsc: "Price: low to high",
  priceDesc: "Price: high to low",
};

/**
 * The ordering of a catalogue nobody has asked anything of — the same default
 * `listingQuerySchema` writes, because this side has to know which of the four is the
 * current one before the query is parsed.
 */
const DEFAULT_SORT: ListingSort = "newest";

/** One ordering, as a link: an ordering is another address, exactly like a filter. */
export type SortOption = {
  value: ListingSort;
  label: string;
  href: string;
  current: boolean;
};

/**
 * The four orderings the contract offers, each of them a link to this same search under it.
 *
 * An address rather than a value submitted somewhere: the ordering lives in the address
 * bar like every filter, so switching it survives a reload and is undone by the browser's
 * Back button — the select in the toolbar navigates to the link of the option it was
 * given. The set is `listingSortSchema.options` rather than a list written out here, so a
 * fifth ordering added to the contract appears on the screen with a label and nothing else
 * to remember.
 *
 * The default leaves no trace in the URL — a catalogue ordered by what has just appeared
 * is the bare `/listings` — so the value is dropped rather than spelled out when it is the
 * one the schema would have chosen anyway.
 */
export function sortOptions(values: FilterValues): SortOption[] {
  const current = currentSort(values.sort);

  return listingSortSchema.options.map((value) => ({
    value,
    label: SORT_LABELS[value],
    href: catalogueHref({
      ...values,
      sort: value === DEFAULT_SORT ? "" : value,
    }),
    current: value === current,
  }));
}

/**
 * The same ordering with nothing filtered, for the "Clear all" of the chips and of the
 * dialog. An ordering is not a filter — there is no unordered catalogue to fall back to —
 * so clearing the filters leaves it where the visitor put it.
 */
export function clearedFiltersHref(values: FilterValues): string {
  return catalogueHref({
    from: "",
    to: "",
    minPrice: "",
    maxPrice: "",
    guests: "",
    sort: values.sort,
  });
}

/**
 * Which of the four is on. Nothing in the URL means the default; something the contract
 * refuses means none of them is marked — the parse has already refused the search, and the
 * message beside the box is what says so rather than an option pretending to be current.
 */
function currentSort(value: string): ListingSort | null {
  if (value === "") return DEFAULT_SORT;

  const parsed = listingSortSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/**
 * A filter as a chip: what it says, and the link that takes it off. Removing one is a
 * link rather than a button for the same reason searching is a `GET` form — the filters
 * live in the address bar, so taking one away is another address, and it needs neither
 * JavaScript nor a round trip through an action to be spelled.
 */
export type ActiveFilter = {
  key: string;
  label: string;
  /** The same search without this filter — and without a cursor, see `catalogueHref`. */
  href: string;
};

/**
 * What this visitor is currently filtering by, as chips.
 *
 * The dates are one chip rather than two, and that is the contract's rule showing through:
 * `listingQuerySchema` refuses half a range, so taking away the check-in of a search that
 * still has a check-out would leave a link the catalogue cannot answer. They go together
 * because they arrived together.
 *
 * A value that is not a day or not a number is shown as it was typed. It reaches here
 * out of a URL, so it is untrusted text like everything else in `searchParams`: the
 * parse has already refused the search, and the chip's job is to name what was asked for
 * so that it can be taken off again.
 */
export function activeFilters(values: FilterValues): ActiveFilter[] {
  const filters: ActiveFilter[] = [];

  if (values.from !== "" || values.to !== "") {
    filters.push({
      key: "dates",
      label: `${dayLabel(values.from)} → ${dayLabel(values.to)}`,
      href: catalogueHref({ ...values, from: "", to: "" }),
    });
  }

  if (values.minPrice !== "") {
    filters.push({
      key: "minPrice",
      label: `From ${priceLabel(values.minPrice)} a night`,
      href: catalogueHref({ ...values, minPrice: "" }),
    });
  }

  if (values.maxPrice !== "") {
    filters.push({
      key: "maxPrice",
      label: `Up to ${priceLabel(values.maxPrice)} a night`,
      href: catalogueHref({ ...values, maxPrice: "" }),
    });
  }

  if (values.guests !== "") {
    filters.push({
      key: "guests",
      label: `${values.guests} ${values.guests === "1" ? "guest" : "guests"}`,
      href: catalogueHref({ ...values, guests: "" }),
    });
  }

  return filters;
}

/** A day for a chip to carry, or the word for the half of a range that was left empty. */
function dayLabel(value: string): string {
  if (value === "") return "any date";

  return isDay(value) ? formatDay(value) : value;
}

/** A price on its way to a screen, like everywhere else — or the text as it arrived. */
function priceLabel(value: string): string {
  const amount = Number(value);

  return Number.isFinite(amount) ? formatMoney(amount) : value;
}

/**
 * One value or none. A parameter repeated in the URL arrives as an array, and this
 * application never writes one — so rather than guessing which of them was meant, the
 * filter is dropped and the search is the one the visitor can see in the boxes.
 */
function single(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A link carries only the filters that are set — the parse would accept the blanks too. */
function withoutEmpty(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== ""),
  );
}
