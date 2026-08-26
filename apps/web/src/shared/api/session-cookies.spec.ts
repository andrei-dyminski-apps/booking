import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@repo/contracts";

/**
 * The parser underneath `mirrorSessionCookies` is not exported, and it is tested through
 * this function rather than around it: what has to hold is not "the header splits into
 * parts" but "the API's answer becomes these cookies on this origin, and nothing else
 * does". The fixtures are therefore the headers Express actually writes in
 * `apps/api/src/auth/cookies.ts`, `Expires` next to `Max-Age` and all.
 */

const store = {
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(store) }));

const { mirrorSessionCookies } = await import("./session-cookies");

const answerWith = (...headers: string[]): Response => {
  const carrier = new Headers();

  for (const header of headers) carrier.append("set-cookie", header);

  return new Response(null, { headers: carrier });
};

/** What `setAuthCookies` produces: Express states the lifetime twice, both ways. */
const issued = (name: string, value: string, seconds: number): string =>
  [
    `${name}=${value}`,
    `Max-Age=${seconds}`,
    "Domain=api.example.com",
    name === ACCESS_TOKEN_COOKIE ? "Path=/" : "Path=/auth",
    `Expires=${new Date(Date.now() + seconds * 1000).toUTCString()}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");

/** What `clearAuthCookies` produces: `res.clearCookie` dates the cookie to 1970. */
const cleared = (name: string, path: string): string =>
  `${name}=; Domain=api.example.com; Path=${path}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;

describe("mirrorSessionCookies", () => {
  beforeEach(() => {
    store.set.mockClear();
    store.delete.mockClear();
  });

  it("re-issues the pair for this origin, translating the scopes", async () => {
    await mirrorSessionCookies(
      answerWith(
        issued(ACCESS_TOKEN_COOKIE, "access.jwt.value", 900),
        issued(REFRESH_TOKEN_COOKIE, "refresh.jwt.value", 604_800),
      ),
    );

    expect(store.set).toHaveBeenNthCalledWith(1, {
      name: ACCESS_TOKEN_COOKIE,
      value: "access.jwt.value",
      path: "/",
      maxAge: 900,
      httpOnly: true,
      sameSite: "lax",
      // Driven by NODE_ENV, which a test run sets to "test".
      secure: false,
    });

    // The API scopes the refresh token to its own `/auth`; here the same restriction has
    // to name the path of the proxy, or the browser would send it with every page request.
    expect(store.set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        name: REFRESH_TOKEN_COOKIE,
        value: "refresh.jwt.value",
        path: "/api/auth",
        maxAge: 604_800,
      }),
    );
  });

  it("copies Max-Age rather than deciding a lifetime of its own", async () => {
    await mirrorSessionCookies(
      answerWith(issued(ACCESS_TOKEN_COOKIE, "value", 42)),
    );

    expect(store.set).toHaveBeenCalledWith(
      expect.objectContaining({ maxAge: 42 }),
    );
  });

  it("leaves the lifetime to the browser when the API states none", async () => {
    await mirrorSessionCookies(
      answerWith(`${ACCESS_TOKEN_COOKIE}=value; Path=/; HttpOnly`),
    );

    expect(store.set).toHaveBeenCalledWith(
      expect.not.objectContaining({ maxAge: expect.anything() }),
    );
  });

  it("deletes the pair when a logout dates it to 1970", async () => {
    await mirrorSessionCookies(
      answerWith(
        cleared(ACCESS_TOKEN_COOKIE, "/"),
        cleared(REFRESH_TOKEN_COOKIE, "/auth"),
      ),
    );

    expect(store.set).not.toHaveBeenCalled();
    expect(store.delete).toHaveBeenNthCalledWith(1, {
      name: ACCESS_TOKEN_COOKIE,
      path: "/",
    });
    expect(store.delete).toHaveBeenNthCalledWith(2, {
      name: REFRESH_TOKEN_COOKIE,
      path: "/api/auth",
    });
  });

  it("reads the other spelling of forgetting, Max-Age=0", async () => {
    await mirrorSessionCookies(
      answerWith(`${ACCESS_TOKEN_COOKIE}=; Max-Age=0; Path=/`),
    );

    expect(store.delete).toHaveBeenCalledWith({
      name: ACCESS_TOKEN_COOKIE,
      path: "/",
    });
  });

  it("ignores a cookie that is not one of the two", async () => {
    await mirrorSessionCookies(
      answerWith("connect.sid=s%3Asomething; Path=/; HttpOnly"),
    );

    // Re-issuing it under this origin's name would be forging a cookie nobody asked for.
    expect(store.set).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("keeps a value that contains the separator", async () => {
    await mirrorSessionCookies(
      answerWith(`${ACCESS_TOKEN_COOKIE}=a.b==; Max-Age=60; Path=/`),
    );

    expect(store.set).toHaveBeenCalledWith(
      expect.objectContaining({ value: "a.b==" }),
    );
  });

  it("does not reach for the cookie jar when the answer sets nothing", async () => {
    await mirrorSessionCookies(new Response(null));

    expect(store.set).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
  });
});
