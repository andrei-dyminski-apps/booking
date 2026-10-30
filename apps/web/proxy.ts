// Next.js 16 renamed `middleware.ts` to `proxy.ts`; the code behind it is the shell of
// the application, so it lives in the app layer like the layout does.
export { proxy } from "#_app/proxy";

/**
 * The one thing that cannot move there with it. Next.js parses this object out of the
 * source of this very file while building — before a single import is evaluated — so it
 * has to be spelled here and spelled with literals.
 *
 * Every page, because every page carries the Content-Security-Policy and its nonce; which
 * of them a stranger is sent away from is decided in the function (`PROTECTED`). Left out
 * are the BFF, Next's own static files and the router's prefetches, none of which is a
 * document a policy applies to. `api` is the segment, not the prefix: `/apiary` would be a
 * page like any other.
 *
 * A prefetch therefore skips the cookie gate as well, and costs a render instead of a
 * redirect: the page behind it still calls `requireUser`, and the shell only links a
 * protected section for somebody signed in.
 */
export const config = {
  matcher: [
    {
      source: "/((?!api(?:/|$)|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
