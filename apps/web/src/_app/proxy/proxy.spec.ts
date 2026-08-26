import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@repo/contracts";
import { proxy } from "./proxy";

/**
 * The cheap half of the session gate: a request with no access cookie never reaches a
 * page. What has to hold is the redirect target — `next` has to carry the visitor back to
 * where they were going, query string included — since that is the one part of this
 * function a stranger's URL can influence.
 */

const requestFor = (path: string, cookie?: string): NextRequest =>
  new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: cookie === undefined ? undefined : { cookie },
  });

describe("proxy", () => {
  it("lets a request carrying the access cookie through", () => {
    const response = proxy(
      requestFor("/profile", `${ACCESS_TOKEN_COOKIE}=some.jwt.value`),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects a request with no access cookie to the login page", () => {
    const response = proxy(requestFor("/profile"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });

  it("points `next` at the page the visitor was headed to, query string included", () => {
    const response = proxy(requestFor("/profile?tab=bookings"));

    const location = new URL(response.headers.get("location")!);

    expect(location.searchParams.get("next")).toBe("/profile?tab=bookings");
  });

  it("ignores a cookie of any other name", () => {
    const response = proxy(requestFor("/profile", "connect.sid=s%3Asomething"));

    expect(response.status).toBe(307);
  });
});
