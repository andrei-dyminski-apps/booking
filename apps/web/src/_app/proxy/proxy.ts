import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@repo/contracts";
import { NONCE_HEADER, ROUTES } from "#shared/config";
import { contentSecurityPolicy } from "./content-security-policy";

/**
 * The sections a stranger has nothing to see in. A new protected route is a line here;
 * each prefix guards the route itself and everything under it.
 */
const PROTECTED: readonly string[] = [
  ROUTES.profile,
  ROUTES.bookings,
  ROUTES.waitlist,
  ROUTES.messages,
  ROUTES.dashboard,
  ROUTES.admin,
  // A guest's reviews have no page of their own at `/guests`, only under an id.
  "/guests",
  ROUTES.notifications,
];

/**
 * Runs in front of every page, for two reasons.
 *
 * **The Content-Security-Policy, with a nonce per request.** The policy names the nonce,
 * and the same policy goes on the request as well as the response: Next.js reads it there
 * and puts the nonce on the scripts it writes into the page, and the root layout reads
 * `x-nonce` for the one script of its own (the theme). Every page here renders per request
 * already — the shell reads the session — so a nonce costs no static page.
 *
 * **The cheap half of protecting a route**: a visitor with no access cookie is sent to the
 * login page before Next.js renders anything. It is deliberately not the check that
 * matters — the cookie is httpOnly and its signature can only be verified by the API — so
 * the page behind it still asks `/auth/me` and still has to cope with a 401. A session whose
 * access token expired arrives without the cookie too; the login page trades the refresh
 * cookie, which is never attached to a page request, for a new pair before it shows a form.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (isProtected(pathname) && !request.cookies.has(ACCESS_TOKEN_COOKIE)) {
    const login = new URL(ROUTES.login, request.url);

    login.searchParams.set("next", `${pathname}${search}`);

    return NextResponse.redirect(login);
  }

  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy(nonce, {
    development: process.env.NODE_ENV === "development",
    preview: process.env.VERCEL_ENV === "preview",
  });
  const headers = new Headers(request.headers);

  headers.set(NONCE_HEADER, nonce);
  headers.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers } });

  response.headers.set("Content-Security-Policy", policy);

  return response;
}

function isProtected(pathname: string): boolean {
  return PROTECTED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
