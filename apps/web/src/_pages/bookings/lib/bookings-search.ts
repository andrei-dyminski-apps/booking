import {
  bookingQuerySchema,
  bookingSortSchema,
  bookingStatusSchema,
  BookingStatus,
  type BookingQuery,
  type BookingSort,
} from "@repo/contracts";
import { ROUTES } from "#shared/config";
import {
  dayLabelOrAny,
  filtersHref,
  searchParamsHref,
  singleParam,
  toFieldErrors,
  type FieldErrors,
} from "#shared/lib";
import type { SortOption } from "#shared/ui";

/**
 * What the boxes of the filter form hold — text, because that is what a URL carries.
 *
 * `sort` travels with them although it is not a filter: it is a value of the same URL, so
 * every link this file writes has to carry it or a chip would silently reorder the list.
 */
export type FilterValues = {
  status: string;
  listingId: string;
  guestId: string;
  from: string;
  to: string;
  sort: string;
};

export type BookingsSearch = {
  /**
   * The question to put to the API, or `null` when what arrived in the URL is not one it
   * can answer. Half a date window is the case that happens in practice — the form lets a
   * visitor fill one box and leave the other — and the honest answer to it is the message
   * the contract already writes, not the unfiltered list somebody would mistake for a
   * result.
   */
  query: BookingQuery | null;
  errors: FieldErrors;
  values: FilterValues;
  /**
   * The address this search belongs at, or `null` when the URL already spells it. The
   * catalogue's rule, over a different list and for the same reason: the dialog is a
   * `GET` form, so the ordinary way to arrive here is `?status=CONFIRMED&listingId=&…`
   * — the same search the chips and the ordering write as `?status=CONFIRMED`. Both are
   * answered identically, and one list under two addresses is a link longer than the
   * search it carries, a second entry in the router cache for a page already there, and
   * two spellings of the same link to send somebody.
   *
   * The Data Cache is not the argument here that it is for the catalogue — this read is
   * `no-store` and keyed by nothing — which is why the redirect buys a little less and
   * costs exactly as much. It is here so that the two screens do not answer the same
   * question differently.
   */
  canonical: string | null;
};

/**
 * The filters of the stays screen as they arrive: `searchParams` is untrusted text, so the
 * same schema that validates the query string on the API side parses it here, and what it
 * refuses is shown under the box it belongs to.
 *
 * None of it is a scope. What this visitor may see is decided by the session on the API
 * side — a guest sees their own stays, an owner the ones taken against their listings, an
 * admin all of them — and every value below narrows that further. `guestId` in particular
 * is not a way around it: for a guest it can only ever name themselves.
 *
 * An empty box is not a filter, and the contract is what says so: `bookingQuerySchema`
 * reads each blank as the absence it means, so a search is answered the same however many
 * empty boxes the form submitted along with it. What the blanks do not survive is the
 * address bar — see `canonical`.
 */
export function readBookingsSearch(
  params: Record<string, string | string[] | undefined>,
): BookingsSearch {
  const values: FilterValues = {
    status: singleParam(params.status),
    listingId: singleParam(params.listingId),
    guestId: singleParam(params.guestId),
    from: singleParam(params.from),
    to: singleParam(params.to),
    sort: singleParam(params.sort),
  };

  const cursor = singleParam(params.cursor);
  const parsed = bookingQuerySchema.safeParse({ ...values, cursor });

  const href = bookingsHref(values, cursor === "" ? undefined : cursor);
  const canonical =
    href === searchParamsHref(ROUTES.bookings, params) ? null : href;

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
 * A link to the stays carrying these filters, and the next page of them when a cursor is
 * handed over. `filtersHref` does the assembling; what stays here is the route and the
 * field order every link of this slice shares. The cursor is deliberately not part of the
 * filter form: changing what is being asked for starts the pages again, and one left over
 * from the previous question would answer a different one — the ordering is the same thing
 * said more strictly, since the API refuses a cursor against another ordering, and every
 * link below is written without one for that reason.
 */
export function bookingsHref(values: FilterValues, cursor?: string): string {
  return filtersHref(ROUTES.bookings, values, cursor);
}

/**
 * The four states of a stay, named for a person. Keyed by the contract's own enum, so a
 * fifth status stops compiling here rather than appearing as a blank option — and read by
 * the badge on every card as well as by the filter, because a status called one thing in
 * the box and another on the row is two names for one value.
 */
export const STATUS_LABELS: Record<BookingStatus, string> = {
  [BookingStatus.PENDING_PAYMENT]: "On hold",
  [BookingStatus.CONFIRMED]: "Confirmed",
  [BookingStatus.CANCELLED]: "Cancelled",
  [BookingStatus.EXPIRED]: "Lapsed",
};

/** The statuses a visitor can filter by, in the order the lifecycle runs. */
export const statusOptions = bookingStatusSchema.options.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));

/**
 * How each ordering reads on the screen. The names of the contract say what is compared
 * and in which direction; these say what a visitor is choosing between.
 */
const SORT_LABELS: Record<BookingSort, string> = {
  newest: "Booked most recently",
  oldest: "Booked first",
  checkInAsc: "Check-in: earliest",
  checkInDesc: "Check-in: latest",
};

/**
 * The ordering of a list nobody has asked anything of — the same default
 * `bookingQuerySchema` writes, because this side has to know which of the four is the
 * current one before the query is parsed.
 */
const DEFAULT_SORT: BookingSort = "newest";

/**
 * The four orderings the contract offers, each of them a link to this same search under
 * it. The set is `bookingSortSchema.options` rather than a list written out here, so a
 * fifth ordering added to the contract appears on the screen with a label and nothing else
 * to remember.
 *
 * The default leaves no trace in the URL, and every link drops the cursor: page four of
 * the newest stays is not a place in the earliest ones, and the API says so with a `400`.
 */
export function sortOptions(values: FilterValues): SortOption[] {
  const current = currentSort(values.sort);

  return bookingSortSchema.options.map((value) => ({
    value,
    label: SORT_LABELS[value],
    href: bookingsHref({
      ...values,
      sort: value === DEFAULT_SORT ? "" : value,
    }),
    current: value === current,
  }));
}

/**
 * The same ordering with nothing filtered, for the "Clear all" of the chips and of the
 * dialog. An ordering is not a filter — there is no unordered list to fall back to — so
 * clearing the filters leaves it where the visitor put it.
 */
export function clearedFiltersHref(values: FilterValues): string {
  return bookingsHref({
    status: "",
    listingId: "",
    guestId: "",
    from: "",
    to: "",
    sort: values.sort,
  });
}

/**
 * This same screen showing one listing's stays and nothing else — the link a card offers
 * an owner or an admin. It is a filter like any other: it lands in the address bar, the
 * chip beside it takes it off again, and everything else about the search starts fresh,
 * because a card is not the middle of a search somebody was already running.
 */
export function listingStaysHref(listingId: string): string {
  return bookingsHref({
    status: "",
    listingId,
    guestId: "",
    from: "",
    to: "",
    sort: "",
  });
}

/**
 * Which of the four is on. Nothing in the URL means the default; something the contract
 * refuses means none of them is marked — the parse has already refused the search, and the
 * message beside the box is what says so rather than an option pretending to be current.
 */
function currentSort(value: string): BookingSort | null {
  if (value === "") return DEFAULT_SORT;

  const parsed = bookingSortSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/**
 * A filter as a chip: what it says, and the link that takes it off. Removing one is a link
 * rather than a button for the same reason searching is a `GET` form — the filters live in
 * the address bar, so taking one away is another address, and it needs neither JavaScript
 * nor a round trip through an action to be spelled.
 */
export type ActiveFilter = {
  key: string;
  label: string;
  /** The same search without this filter — and without a cursor, see `bookingsHref`. */
  href: string;
};

/**
 * What is currently being filtered by, as chips.
 *
 * The dates are one chip rather than two, and that is the contract's rule showing through:
 * `bookingQuerySchema` refuses half a window, so taking away the start of a search that
 * still has an end would leave a link the API cannot answer. They go together because they
 * arrived together.
 *
 * An id is shown by the name of the row it names where the page could resolve one — the
 * title of the listing, the address of the guest. Where it could not, the id is shortened
 * rather than dropped: it came out of a URL and the chip's job is to name what was asked
 * for so that it can be taken off again. The same is true of a value the contract refused,
 * which is shown exactly as it was typed.
 */
export function activeFilters(
  values: FilterValues,
  names: { listing?: string | undefined; guest?: string | undefined } = {},
): ActiveFilter[] {
  const filters: ActiveFilter[] = [];

  if (values.status !== "") {
    filters.push({
      key: "status",
      label: statusLabel(values.status),
      href: bookingsHref({ ...values, status: "" }),
    });
  }

  if (values.listingId !== "") {
    filters.push({
      key: "listingId",
      label: names.listing ?? `Listing ${shortId(values.listingId)}`,
      href: bookingsHref({ ...values, listingId: "" }),
    });
  }

  if (values.guestId !== "") {
    filters.push({
      key: "guestId",
      label: names.guest ?? `Guest ${shortId(values.guestId)}`,
      href: bookingsHref({ ...values, guestId: "" }),
    });
  }

  if (values.from !== "" || values.to !== "") {
    filters.push({
      key: "dates",
      label: `${dayLabelOrAny(values.from)} → ${dayLabelOrAny(values.to)}`,
      href: bookingsHref({ ...values, from: "", to: "" }),
    });
  }

  return filters;
}

/** A status for a chip to carry, or the text as it arrived when the contract refused it. */
function statusLabel(value: string): string {
  const parsed = bookingStatusSchema.safeParse(value);

  return parsed.success ? STATUS_LABELS[parsed.data] : value;
}

/**
 * Enough of an id to recognise it by and to tell two of them apart, which is all a chip
 * can do with one nothing on this page resolves to a name. Anything the contract refused
 * is left whole — it is not an id, and cutting it would hide what was typed.
 */
function shortId(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}…` : value;
}
