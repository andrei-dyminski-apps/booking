import {
  RefundFailureStatus,
  Role,
  type RefundFailureStatus as RefundFailureStatusName,
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
 * A link to one tab, and to the next page of it when a cursor is handed over — the only
 * spelling of the screen's address, so a notice's link and the address the page reads are
 * the same string. The default list and the open refunds leave no trace in the URL, as a
 * default ordering does not; `status` belongs to the bounced refunds alone.
 */
export function setAsideHref(
  list: SetAsideList,
  status: RefundFailureStatusName = RefundFailureStatus.OPEN,
  cursor?: string,
): string {
  return filtersHref(
    ROUTES.adminPayments,
    {
      list: list === DEFAULT_SET_ASIDE_LIST ? "" : list,
      status:
        list === "bounced" && status !== RefundFailureStatus.OPEN ? status : "",
    },
    cursor,
  );
}
