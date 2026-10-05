// Next.js 16 renamed `middleware.ts` to `proxy.ts`; the code behind it is the shell of
// the application, so it lives in the app layer like the layout does.
export { proxy } from "#_app/proxy";

/**
 * The one thing that cannot move there with it. Next.js parses this object out of the
 * source of this very file while building — before a single import is evaluated — so it
 * has to be spelled here and spelled with literals: a re-export is refused outright, and
 * `ROUTES.profile` would be an unresolved name at that moment.
 *
 * `/:path*` matches the route itself and everything under it, so a nested page is
 * guarded the day it appears.
 */
export const config = {
  matcher: [
    "/profile/:path*",
    "/bookings/:path*",
    "/dashboard/:path*",
    "/admin/:path*",
  ],
};
