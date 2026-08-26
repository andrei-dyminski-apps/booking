import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@repo/contracts";
import { ROUTES } from "#shared/config";

/**
 * The cheap half of protecting a route: a visitor with no access cookie is sent to the
 * login page before Next.js renders anything. It is deliberately not the check that
 * matters — the cookie is httpOnly and its signature can only be verified by the API,
 * which holds the secret — so the page behind it still asks `/auth/me` and still has to
 * cope with an answer of 401. This one only spares the server a render nobody can see.
 *
 * A session whose access token has expired arrives here without the cookie as well,
 * because the browser drops it at its Max-Age. That is not a dead session: the refresh
 * cookie outlives it by a week, and the login page trades it for a new pair before it
 * shows a form. What this cannot do is perform that trade itself — the refresh cookie is
 * scoped to the `/auth` path of the proxy, so it is never attached to a request for a
 * page, and this runs for pages only.
 */
export function proxy(request: NextRequest): NextResponse {
  if (request.cookies.has(ACCESS_TOKEN_COOKIE)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const login = new URL(ROUTES.login, request.url);

  login.searchParams.set("next", `${pathname}${search}`);

  return NextResponse.redirect(login);
}
