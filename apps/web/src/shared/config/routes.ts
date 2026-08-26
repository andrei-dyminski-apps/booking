/**
 * Every path of this application in one place: the proxy guards them, the pages link to
 * them and the forms redirect to them, so a renamed route is a compile error rather than
 * a dead link somewhere in the markup.
 *
 * The matcher of `proxy.ts` is the one place that cannot use them — Next.js reads it
 * while building, before any import of ours is evaluated.
 */
export const ROUTES = {
  home: "/",
  login: "/login",
  register: "/register",
  profile: "/profile",
} as const;
