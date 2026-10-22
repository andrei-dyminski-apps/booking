import {
  StayParty,
  waitlistDemandQuerySchema,
  waitlistSortSchema,
  type WaitlistDemandQuery,
  type WaitlistSort,
} from "@repo/contracts";
import { ROUTES } from "#shared/config";
import {
  filtersHref,
  singleParam,
  toFieldErrors,
  type FieldErrors,
} from "#shared/lib";
import type { SortOption } from "#shared/ui";

/**
 * What the URL of the waitlist carries: which side a user is looking at, and the ordering
 * of the paged side. `side` is first, so the tab a link opens is the first thing its
 * address says — the order the stays' links keep.
 */
export type WaitlistValues = { side: string; sort: string };

export type WaitlistSearch = {
  values: WaitlistValues;
  /**
   * The question for `GET /waitlist/demand`, or `null` when the URL holds an ordering the
   * contract refuses — the refusal is then shown beside the box that takes it off again.
   */
  query: WaitlistDemandQuery | null;
  errors: FieldErrors;
};

/**
 * `searchParams` as the waitlist reads them. There is nothing here that could be a scope:
 * the API answers a user the ranges on their own listings and an admin every one, and
 * `side` only picks which of a user's two lists to draw. The guest's side is answered
 * whole, so its URL needs nothing past the side.
 */
export function readWaitlistSearch(
  params: Record<string, string | string[] | undefined>,
): WaitlistSearch {
  const values: WaitlistValues = {
    side: singleParam(params.side),
    sort: singleParam(params.sort),
  };
  const cursor = singleParam(params.cursor);
  const parsed = waitlistDemandQuerySchema.safeParse({
    sort: values.sort,
    cursor,
  });

  return parsed.success
    ? { values, query: parsed.data, errors: {} }
    : { values, query: null, errors: toFieldErrors(parsed.error.issues) };
}

/** A link to the waitlist under these values, and the next page when a cursor is handed over. */
export function waitlistHref(values: WaitlistValues, cursor?: string): string {
  return filtersHref(ROUTES.waitlist, values, cursor);
}

/**
 * Which list a user is looking at. Anything but `HOST` is their own ranges — the default,
 * and what an empty `?side=` lands on.
 */
export function sideOf(values: WaitlistValues): StayParty {
  return values.side === StayParty.HOST ? StayParty.HOST : StayParty.GUEST;
}

const SIDE_LABELS: Record<StayParty, string> = {
  [StayParty.GUEST]: "Waiting for",
  [StayParty.HOST]: "On your listings",
};

/**
 * The two lists as tabs, each with nothing past its side: the guest's has no ordering to
 * keep, and a cursor of one is no place in the other.
 */
export function sideTabs(
  values: WaitlistValues,
): Array<{ side: StayParty; label: string; href: string; current: boolean }> {
  const current = sideOf(values);

  return [StayParty.GUEST, StayParty.HOST].map((side) => ({
    side,
    label: SIDE_LABELS[side],
    href: waitlistHref({
      side: side === StayParty.GUEST ? "" : side,
      sort: "",
    }),
    current: side === current,
  }));
}

const SORT_LABELS: Record<WaitlistSort, string> = {
  checkInAsc: "Check-in: earliest",
  newest: "Joined most recently",
};

/** The default `waitlistDemandQuerySchema` writes, needed before the query is parsed. */
const DEFAULT_SORT: WaitlistSort = "checkInAsc";

/**
 * The orderings the contract offers, each a link to the same side under it — with no
 * cursor, which names a place in one ordering only. The default leaves no trace in the URL.
 */
export function sortOptions(values: WaitlistValues): SortOption[] {
  const current = currentSort(values.sort);

  return waitlistSortSchema.options.map((value) => ({
    value,
    label: SORT_LABELS[value],
    href: waitlistHref({
      ...values,
      sort: value === DEFAULT_SORT ? "" : value,
    }),
    current: value === current,
  }));
}

/** Nothing in the URL is the default; a value the contract refuses marks none of them. */
function currentSort(value: string): WaitlistSort | null {
  if (value === "") return DEFAULT_SORT;

  const parsed = waitlistSortSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}
