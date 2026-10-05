import { Role } from "@repo/contracts";

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
  dashboard: "/dashboard",
  newListing: "/dashboard/listings/new",
  editListing: (id: string) => `/dashboard/listings/${encodeURIComponent(id)}`,
  admin: "/admin",
  adminListing: (id: string) => `/admin/listings/${encodeURIComponent(id)}`,
  adminUsers: "/admin/users",
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
