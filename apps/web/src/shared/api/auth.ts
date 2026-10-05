import { cache } from "react";
import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import {
  userSchema,
  type LoginInput,
  type RegisterInput,
  type Role,
  type User,
} from "@repo/contracts";
import { HTTP_STATUS, listingsSectionFor, ROUTES } from "../config";
import { ApiResponseError, apiRequest, type ReadOptions } from "./http-client";
import { mirrorSessionCookies } from "./session-cookies";

/**
 * The routes of the session, written down once like every other resource. None of them
 * returns a token: the pair leaves the API as httpOnly cookies, and this origin takes
 * them over rather than passing them on — `mirrorSessionCookies` is what re-issues them
 * here, which is what makes the session first-party.
 *
 * Which side calls which route is decided by the scope of the cookie it needs, not by
 * taste:
 *
 * - `register` and `login` are handed a session rather than asked for one, so they can run
 *   anywhere a cookie can be written — that is the server, from the Server Actions of the
 *   forms that submit to them, and `mirrorSessionCookies` is passed the answer directly.
 * - `logout` needs the refresh token, and only the browser is ever handed one: it is
 *   scoped to the `/auth` path of the proxy, so a Server Action — which posts to the URL
 *   of the page it sits on — is never given it, and the API would have nothing to revoke.
 *   It is called from the browser and reaches the API through the BFF, which mirrors the
 *   cleared cookies the same way it mirrors the issued ones.
 * - `refresh` is the same case and is not here at all: the transport has to spend it in
 *   the middle of somebody else's request (`refreshSession` in `http-client.ts`).
 * - `me` needs only the access cookie, which both sides have.
 */
export const authApi = {
  register: (input: RegisterInput): Promise<User> =>
    apiRequest({
      method: "POST",
      path: "/auth/register",
      schema: userSchema,
      body: input,
      onResponse: mirrorSessionCookies,
      retryOnUnauthorized: false,
    }),

  login: (input: LoginInput): Promise<User> =>
    apiRequest({
      method: "POST",
      path: "/auth/login",
      schema: userSchema,
      body: input,
      onResponse: mirrorSessionCookies,
      retryOnUnauthorized: false,
    }),

  // No `onResponse`: this one runs in the browser, where the API's answer is the proxy's
  // answer and the cookies have already been cleared for this origin by the time it
  // arrives. A `Set-Cookie` is not readable from a fetch response there either.
  logout: (): Promise<void> =>
    apiRequest({
      method: "POST",
      path: "/auth/logout",
      schema: z.void(),
      retryOnUnauthorized: false,
    }),

  me: (read: ReadOptions): Promise<User> =>
    apiRequest({
      method: "GET",
      path: "/auth/me",
      schema: userSchema,
      read,
    }),
};

/**
 * Who is asking, or nobody. A 401 from `/auth/me` is the anonymous case rather than a
 * failure — the token is missing, expired, or its user has been deleted — and a screen
 * that renders differently for a guest wants that as a value, not as an exception. Every
 * other status stays an error.
 *
 * It takes no `ReadOptions`, unlike every other read of this segment, and that is the
 * point rather than an omission: the session is personal, the Data Cache is keyed by URL
 * and shared between visitors, so `no-store` is the only answer a call site could give.
 * Nothing to decide is what makes the read below memoizable.
 *
 * Once per render, and it has to be said out loud because the transport gives up the
 * memoization Next.js would have performed for it: `AbortSignal.timeout` opts a request
 * out of the per-render cache (see `http-client.ts`), so the shell asking who is signed
 * in and the page under it asking the same question were two round trips to the API on
 * every single render. `cache()` from React is the request-scoped one that survives that
 * — it keys on the arguments, which is the second reason this function has none.
 */
export const currentUser = cache(async (): Promise<User | null> => {
  try {
    return await authApi.me({ cache: "no-store" });
  } catch (error) {
    if (
      error instanceof ApiResponseError &&
      error.status === HTTP_STATUS.UNAUTHORIZED
    ) {
      return null;
    }

    throw error;
  }
});

/**
 * The same read for a page that has nothing to show a stranger. The proxy has already
 * turned away a visitor carrying no cookie at all; what reaches here without a session is
 * one whose access token expired between the two checks, or whose row is gone — and the
 * login page is where a live refresh token is traded for a new pair, because the browser
 * is the only side that receives one.
 *
 * Where to come back to is an argument rather than something read from the request: a
 * server render is not told its own path, and the caller knows it as a `ROUTES` constant
 * anyway.
 */
export async function requireUser(next: string): Promise<User> {
  const user = await currentUser();

  if (user !== null) return user;

  redirect(`${ROUTES.login}?next=${encodeURIComponent(next)}`);
}

/**
 * The same read for a section that belongs to one role. It is not the access check — the
 * role is a claim of the access token and only the API holds the secret that verifies it,
 * so every request the page makes is refused on its own merits regardless of what happens
 * here. What this decides is what the visitor is shown instead of a screen full of 403s.
 *
 * A wrong role answers `notFound()` rather than a message: the dashboard is the owner's
 * own section, and to everybody else it is a URL with nothing behind it. Membership of a
 * set rather than a hierarchy, exactly as `RolesGuard` reads it — an admin does not reach
 * an owner's screen by being senior to an owner.
 */
export async function requireRole(role: Role, next: string): Promise<User> {
  const user = await requireUser(next);

  if (user.role !== role) notFound();

  return user;
}

/**
 * Sends the author of a listing write back to the section of their role — an owner's
 * dashboard or the admin's list, see `listingsSectionFor`. The session says which rather
 * than a value the screen binds: an action is an endpoint of its own, and a destination it
 * was handed would be one more value to distrust.
 *
 * It runs after the write has already happened, so it must not fail the action: an API
 * that times out, answers a 5xx or a 429 here would otherwise turn a save that went
 * through into an error screen, and the retry of a delete into a 404. Any failure to read
 * the session lands on the dashboard, which is where every write went before roles had
 * sections of their own.
 */
export async function redirectToListingsSection(): Promise<never> {
  const section = await currentUser().then(
    (user) =>
      user === null ? ROUTES.dashboard : listingsSectionFor(user.role),
    () => ROUTES.dashboard,
  );

  redirect(section);
}
