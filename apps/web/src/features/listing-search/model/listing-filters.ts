import {
  centsSchema,
  listingQuerySchema,
  listingSortSchema,
  type ListingQuery,
  type ListingSort,
} from "@repo/contracts";
import {
  centsFromInput,
  countOf,
  dayLabelOrAny,
  formatMoney,
  toFieldErrors,
  type FieldErrors,
} from "#shared/lib";
import type { FilterChip, SortOption } from "#shared/ui";

/**
 * The boxes of a search over `listingQuerySchema` — text, because that is what a URL
 * carries. The prices are in the currency itself, as a visitor types and reads them —
 * `?minPrice=100` — and become the contract's `minPriceCents` only on the way to the parse
 * (`parseListingQuery`). Two screens put that question: the catalogue, and the admin's listings, which
 * add `ownerId` on top. What both ask is here; the route, the extra field and the reading
 * of `searchParams` stay in each page's slice.
 *
 * `sort` travels with them although it is not a filter: it is a value of the same URL, so
 * every link a slice writes has to carry it or a chip would silently reorder the list.
 */
export type ListingFilterValues = {
  from: string;
  to: string;
  minPrice: string;
  maxPrice: string;
  guests: string;
  sort: string;
};

/** The same values with nothing filtered — every box blank, the ordering kept. */
export function withoutListingFilters<Values extends ListingFilterValues>(
  values: Values,
): Values {
  return {
    ...values,
    from: "",
    to: "",
    minPrice: "",
    maxPrice: "",
    guests: "",
  };
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
 * The ordering of a list nobody has asked anything of — the same default
 * `listingQuerySchema` writes, because this side has to know which of the four is the
 * current one before the query is parsed.
 */
const DEFAULT_SORT: ListingSort = "newest";

/**
 * The four orderings the contract offers, each of them a link to this same search under it,
 * written by `href` — the slice's own link builder.
 *
 * The set is `listingSortSchema.options` rather than a list written out here, so a fifth
 * ordering added to the contract appears on both screens with a label and nothing else to
 * remember. The default leaves no trace in the URL, so `href` is handed a blank for it
 * rather than the name the schema would have chosen anyway.
 */
export function listingSortOptions<Values extends ListingFilterValues>(
  values: Values,
  href: (values: Values) => string,
): SortOption[] {
  const current = currentSort(values.sort);

  return listingSortSchema.options.map((value) => ({
    value,
    label: SORT_LABELS[value],
    href: href({ ...values, sort: value === DEFAULT_SORT ? "" : value }),
    current: value === current,
  }));
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
 * The filters of `listingQuerySchema` that are on, as chips, each linking through `href`
 * to the same search without it.
 *
 * The dates are one chip rather than two, and that is the contract's rule showing through:
 * `listingQuerySchema` refuses half a range, so taking away the check-in of a search that
 * still has a check-out would leave a link the list cannot answer.
 *
 * A value that is not a day or not a number is shown as it was typed. It reaches here
 * out of a URL, so it is untrusted text like everything else in `searchParams`: the
 * parse has already refused the search, and the chip's job is to name what was asked for
 * so that it can be taken off again.
 */
export function listingFilterChips<Values extends ListingFilterValues>(
  values: Values,
  href: (values: Values) => string,
): FilterChip[] {
  const chips: FilterChip[] = [];

  if (values.from !== "" || values.to !== "") {
    chips.push({
      key: "dates",
      label: `${dayLabelOrAny(values.from)} → ${dayLabelOrAny(values.to)}`,
      href: href({ ...values, from: "", to: "" }),
    });
  }

  if (values.minPrice !== "") {
    chips.push({
      key: "minPrice",
      label: `From ${priceLabel(values.minPrice)} a night`,
      href: href({ ...values, minPrice: "" }),
    });
  }

  if (values.maxPrice !== "") {
    chips.push({
      key: "maxPrice",
      label: `Up to ${priceLabel(values.maxPrice)} a night`,
      href: href({ ...values, maxPrice: "" }),
    });
  }

  if (values.guests !== "") {
    chips.push({
      key: "guests",
      label: guestsLabel(values.guests),
      href: href({ ...values, guests: "" }),
    });
  }

  return chips;
}

/** A count of guests, agreed with its noun — or the text as it arrived, like the price. */
function guestsLabel(value: string): string {
  const count = Number(value);

  return Number.isInteger(count) ? countOf(count, "guest") : `${value} guests`;
}

/** A price on its way to a screen, like everywhere else — or the text as it arrived. */
function priceLabel(value: string): string {
  const amount = centsSchema.safeParse(centsFromInput(value));

  return amount.success ? formatMoney(amount.data) : value;
}

/**
 * The boxes put to `listingQuerySchema`, as both listings screens read their URL. The prices
 * typed in the currency become the contract's cents on the way in (`centsFromInput`), and
 * what the schema refuses about `minPriceCents` comes back under the `minPrice` box it was
 * typed into — the one name a visitor knows.
 */
export function parseListingQuery(
  values: ListingFilterValues & { ownerId?: string },
  cursor: string,
):
  | { query: ListingQuery; errors: FieldErrors }
  | { query: null; errors: FieldErrors } {
  const { minPrice, maxPrice, ...rest } = values;
  const parsed = listingQuerySchema.safeParse({
    ...rest,
    minPriceCents: centsFromInput(minPrice),
    maxPriceCents: centsFromInput(maxPrice),
    cursor,
  });

  if (parsed.success) return { query: parsed.data, errors: {} };

  return {
    query: null,
    errors: Object.fromEntries(
      Object.entries(toFieldErrors(parsed.error.issues)).map(
        ([field, messages]) => [BOX_OF_QUERY_FIELD[field] ?? field, messages],
      ),
    ),
  };
}

const BOX_OF_QUERY_FIELD: Partial<Record<string, keyof ListingFilterValues>> = {
  minPriceCents: "minPrice",
  maxPriceCents: "maxPrice",
};
