import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@repo/contracts";
import { BFF_BASE_PATH } from "../config";

/**
 * Where the BFF takes ownership of the session cookies of the browser.
 *
 * The API still issues the pair the only way it can — as `Set-Cookie` on its own host —
 * but those headers never reach the browser: the proxy drops them and this writes the
 * same two tokens again, scoped to this origin instead. The browser therefore holds a
 * first-party session, and the API's own cookie attributes (`AUTH_COOKIE_DOMAIN` above
 * all) stop being a deployment concern of the frontend.
 *
 * What is deliberately not re-decided here is the lifetime: `Max-Age` is copied out of
 * the answer, so `JWT_ACCESS_TTL` and `JWT_REFRESH_TTL` keep one owner rather than two.
 */

/**
 * The paths mirror the scopes the API uses, for the same reason it uses them. Only the
 * access token travels with a request for a page, so a server render of `/profile` sees
 * the session; the refresh token is limited to the proxied routes that consume it, which
 * keeps the credential that mints sessions away from everything else — this server's own
 * renders included.
 */
const SESSION_COOKIE_PATH: Record<string, string> = {
  [ACCESS_TOKEN_COOKIE]: "/",
  [REFRESH_TOKEN_COOKIE]: `${BFF_BASE_PATH}/auth`,
};

/**
 * `lax` rather than `strict`, and it is still the CSRF defence it was before the BFF:
 * a cross-site POST carries no `lax` cookie, so the proxy cannot be driven from another
 * site even though it now shares an origin with the pages.
 */
const COOKIE_ATTRIBUTES = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
} as const;

/**
 * Server-only, like everything that touches the cookie jar of the answer Next.js is
 * building. The import is dynamic for the same reason it is in `http-client.ts`: this
 * module is reached through the public API of the segment, and a static `next/headers`
 * in it would refuse to bundle for the client components that reach the segment too.
 */
export async function mirrorSessionCookies(response: Response): Promise<void> {
  const headers = response.headers.getSetCookie();

  if (headers.length === 0) return;

  const { cookies } = await import("next/headers");
  const store = await cookies();

  for (const header of headers) {
    const parsed = parseSetCookie(header);

    if (parsed === null) continue;

    const path = SESSION_COOKIE_PATH[parsed.name];

    // Anything else the API chooses to set is its own business, and re-issuing it under
    // this origin's name would be forging a cookie nobody asked this server for.
    if (path === undefined) continue;

    if (parsed.expired) {
      store.delete({ name: parsed.name, path });
      continue;
    }

    store.set({
      name: parsed.name,
      value: parsed.value,
      path,
      ...COOKIE_ATTRIBUTES,
      ...(parsed.maxAge === null ? {} : { maxAge: parsed.maxAge }),
    });
  }
}

type ParsedCookie = {
  name: string;
  value: string;
  maxAge: number | null;
  expired: boolean;
};

/**
 * Hand-written rather than a dependency, because the input is not the open set of cookies
 * a browser has to cope with: it is the two headers this repository writes itself, in
 * `apps/api/src/auth/cookies.ts`. Everything a general parser exists for — quoting,
 * `Domain`, `Partitioned`, a name that is not one of the two — is either absent or
 * dropped a few lines above.
 */
function parseSetCookie(header: string): ParsedCookie | null {
  const [pair, ...attributes] = header.split(";");

  if (pair === undefined) return null;

  const separator = pair.indexOf("=");

  // A nameless cookie ("=value") is not one of ours either way.
  if (separator < 1) return null;

  const maxAge = readMaxAge(attributes);
  const expires = readExpires(attributes);

  return {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1).trim(),
    maxAge,
    // Both spellings of "forget this one": `setAuthCookies` states a lifetime in seconds
    // and `clearAuthCookies` goes through `res.clearCookie`, which dates the cookie to
    // 1970 instead — so a logout arrives here as an `Expires` in the past.
    expired:
      (maxAge !== null && maxAge <= 0) ||
      (expires !== null && expires <= Date.now()),
  };
}

function readMaxAge(attributes: string[]): number | null {
  const raw = readAttribute(attributes, "max-age");

  if (raw === null) return null;

  const seconds = Number(raw);

  return Number.isInteger(seconds) ? seconds : null;
}

function readExpires(attributes: string[]): number | null {
  const raw = readAttribute(attributes, "expires");

  if (raw === null) return null;

  const at = Date.parse(raw);

  return Number.isNaN(at) ? null : at;
}

function readAttribute(attributes: string[], name: string): string | null {
  for (const attribute of attributes) {
    const separator = attribute.indexOf("=");

    if (separator < 0) continue;
    if (attribute.slice(0, separator).trim().toLowerCase() !== name) continue;

    return attribute.slice(separator + 1).trim();
  }

  return null;
}
