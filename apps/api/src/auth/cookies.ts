import { parseCookie } from "cookie";
import type { Request, Response } from "express";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@repo/contracts";
import type { AuthConfig } from "./auth.config";

/**
 * The names come from the contract rather than from here: `apps/web` reads the access
 * cookie in its proxy and in its server-side transport, and a name that both sides spell
 * on their own would drift the first time one of them changed it. They are re-exported
 * so that everything on this side keeps reaching them next to the code that sets them.
 */
export { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE };

/**
 * The refresh token is only ever sent to the two routes that consume it, so a request to
 * /bookings does not carry the credential that could mint new sessions.
 */
const REFRESH_COOKIE_PATH = "/auth";

/**
 * `cookie` rather than cookie-parser: the middleware is a wrapper over this same parser
 * whose own contribution is signed cookies, and a JWT verified against JWT_ACCESS_SECRET
 * has no use for a second signature. It would also put `Record<string, any>` on every
 * request for the two places that read a cookie at all.
 *
 * A malformed escape ("access_token=%") comes back raw instead of throwing, so a broken
 * credential reaches the verifier and is answered with a 401 rather than a 500.
 */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;

  if (header === undefined) return null;

  return parseCookie(header)[name] ?? null;
}
export function setAuthCookies(
  res: Response,
  config: AuthConfig,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...config.cookie,
    path: "/",
    maxAge: config.accessTtl * 1000,
  });
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...config.cookie,
    path: REFRESH_COOKIE_PATH,
    maxAge: config.refreshTtl * 1000,
  });
}

/** The attributes have to repeat those of the original cookie, or the browser keeps it. */
export function clearAuthCookies(res: Response, config: AuthConfig): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...config.cookie, path: "/" });
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    ...config.cookie,
    path: REFRESH_COOKIE_PATH,
  });
}
