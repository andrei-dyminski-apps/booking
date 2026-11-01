import {
  RefundFailureStatus,
  Role,
  type FailedPaymentEventQuery,
  type RefundFailureQuery,
  type StuckStayQuery,
} from "@repo/contracts";
import { filtersHref } from "../lib/search-params";

/**
 * Every path of this application in one place: the proxy guards them, the pages link to
 * them and the forms redirect to them, so a renamed route is a compile error rather than
 * a dead link somewhere in the markup.
 *
 * The matcher of `proxy.ts` is the one place that cannot use them — Next.js reads it
 * while building, before any import of ours is evaluated.
 *
 * A route with a dynamic segment is a function rather than a template a caller assembles:
 * the id is encoded here, once, instead of at every link that carries one.
 */
export const ROUTES = {
  home: "/",
  login: "/login",
  register: "/register",
  profile: "/profile",
  catalogue: "/listings",
  listing: (id: string) => `/listings/${encodeURIComponent(id)}`,
  bookings: "/bookings",
  booking: (id: string) => `/bookings/${encodeURIComponent(id)}`,
  waitlist: "/waitlist",
  messages: "/messages",
  conversation: (id: string) => `/messages/${encodeURIComponent(id)}`,
  dashboard: "/dashboard",
  newListing: "/dashboard/listings/new",
  editListing: (id: string) => `/dashboard/listings/${encodeURIComponent(id)}`,
  payouts: "/dashboard/payouts",
  admin: "/admin",
  adminListing: (id: string) => `/admin/listings/${encodeURIComponent(id)}`,
  adminUsers: "/admin/users",
  adminUser: (id: string) => `/admin/users/${encodeURIComponent(id)}`,
  adminPayments: "/admin/payments",
  guestReviews: (id: string) => `/guests/${encodeURIComponent(id)}/reviews`,
  notifications: "/notifications",
} as const;

/**
 * Where a role manages listings from, and so where a save or a delete sends its author
 * back to. Two roles may write a listing and each has a section of its own — an owner's
 * dashboard holds their listings, the admin's section holds everybody's — and the one
 * that wrote is the one that has to land where it started. Any other role has no such
 * section; the dashboard answers it with the same 404 it always has.
 */
export function listingsSectionFor(role: Role): string {
  return role === Role.ADMIN ? ROUTES.admin : ROUTES.dashboard;
}

/**
 * The tabs of the admin's payments screen — what the money paths set aside, one list of
 * the API each. Named here rather than in the page because a second layer links to them:
 * the four admin notices lead to their tab (`describeNotification`), and a layer never
 * imports the page above it.
 */
export const SET_ASIDE_LISTS = [
  "events",
  "bounced",
  "stuck-refunds",
  "stuck-payouts",
] as const;

export type SetAsideList = (typeof SET_ASIDE_LISTS)[number];

/** The tab a bare `/admin/payments` opens on; it leaves no trace in the URL. */
export const DEFAULT_SET_ASIDE_LIST: SetAsideList = "events";

/**
 * Every value the screen's URL may carry past `list`, in the order a link spells them.
 * `status` picks the open or the resolved half of the bounced refunds; the rest narrow a
 * list — the ids the four notices name among them, so a notice opens on its own row.
 */
export const SET_ASIDE_FILTER_KEYS = [
  "status",
  "eventId",
  "type",
  "refundId",
  "paymentId",
  "bookingId",
  "listingId",
  "guestId",
  "hostId",
  "from",
  "to",
] as const;

export type SetAsideFilterKey = (typeof SET_ASIDE_FILTER_KEYS)[number];

/** The values of the screen's URL as text — a missing one is a blank. */
export type SetAsideFilters = Partial<Record<SetAsideFilterKey, string>>;

const STAY_FILTER_KEYS = [
  "bookingId",
  "listingId",
  "guestId",
  "hostId",
  "from",
  "to",
] as const satisfies readonly SetAsideFilterKey[];

/** The filters of a list's query: every key but the paging and `kind`, which a tab is. */
type FilterKeyOf<Query> = Exclude<keyof Query, "cursor" | "limit" | "kind">;

/**
 * The URL keys a list reads, checked against its query both ways — a filter the list left
 * out would otherwise be dropped without a word by every link the screen writes, and by the
 * redirect onto the canonical address.
 *
 * A key the contract does not take fails the constraint, and `tsc` points at it:
 * `Type '"refundId"' is not assignable to type '"type" | "from" | "to" | "eventId"'`. A
 * filter the contract takes and the list leaves out asks the argument for a property a
 * tuple cannot have, so the error names that filter instead of reading `never`:
 * `Property 'missingFilters' is missing in type '["eventId", "type", "from"]' but required
 * in type '{ missingFilters: "to"; }'`.
 */
const filtersOf =
  <Query>() =>
  <const Keys extends readonly (FilterKeyOf<Query> & SetAsideFilterKey)[]>(
    keys: Keys &
      ([Exclude<FilterKeyOf<Query>, Keys[number]>] extends [never]
        ? unknown
        : { missingFilters: Exclude<FilterKeyOf<Query>, Keys[number]> }),
  ): readonly SetAsideFilterKey[] =>
    keys;

/** Which of them each list reads: its query in `@repo/contracts`, said as URL keys. */
export const SET_ASIDE_FILTERS_OF: Record<
  SetAsideList,
  readonly SetAsideFilterKey[]
> = {
  events: filtersOf<FailedPaymentEventQuery>()([
    "eventId",
    "type",
    "from",
    "to",
  ]),
  bounced: filtersOf<RefundFailureQuery>()([
    "status",
    "refundId",
    "paymentId",
    ...STAY_FILTER_KEYS,
  ]),
  "stuck-refunds": filtersOf<StuckStayQuery>()(STAY_FILTER_KEYS),
  "stuck-payouts": filtersOf<StuckStayQuery>()(STAY_FILTER_KEYS),
};

/**
 * A link to one tab with the filters handed over, and to the next page of it when a cursor
 * is — the only spelling of the screen's address, so a notice's link and the address the
 * page reads are the same string. The default list and the open refunds leave no trace in
 * the URL, as a default ordering does not, and a value the list does not read is dropped:
 * a refund's id names nothing among the events.
 */
export function setAsideHref(
  list: SetAsideList,
  filters: SetAsideFilters = {},
  cursor?: string,
): string {
  const values: Record<string, string> = {
    list: list === DEFAULT_SET_ASIDE_LIST ? "" : list,
  };

  for (const key of SET_ASIDE_FILTER_KEYS) {
    const value = SET_ASIDE_FILTERS_OF[list].includes(key)
      ? (filters[key] ?? "")
      : "";

    values[key] =
      key === "status" && value === RefundFailureStatus.OPEN ? "" : value;
  }

  return filtersHref(ROUTES.adminPayments, values, cursor);
}
