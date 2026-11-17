import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { ACCESS_TOKEN_COOKIE } from "@repo/contracts";
import { NONCE_HEADER } from "#shared/config";
import { config } from "../../../proxy";
import { proxy } from "./proxy";

/**
 * The cheap half of the session gate: a request with no access cookie never reaches a
 * protected page. What has to hold is the redirect target — `next` has to carry the visitor
 * back to where they were going, query string included — since that is the one part of
 * this function a stranger's URL can influence. And every page it lets through carries a
 * Content-Security-Policy whose script nonce is fresh and handed to the render as well.
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

  it("lets a stranger reach a public page, and leaves a lookalike path unguarded", () => {
    expect(
      proxy(requestFor("/listings")).headers.get("x-middleware-next"),
    ).toBe("1");
    expect(
      proxy(requestFor("/bookingsx")).headers.get("x-middleware-next"),
    ).toBe("1");
    expect(proxy(requestFor("/bookings/abc")).status).toBe(307);
  });

  it("sends a policy with a fresh script nonce, and hands the nonce to the render", () => {
    const first = proxy(requestFor("/listings"));
    const second = proxy(requestFor("/listings"));
    const policy = first.headers.get("content-security-policy") ?? "";
    const nonce = first.headers.get(`x-middleware-request-${NONCE_HEADER}`);

    expect(nonce).toBeTruthy();
    expect(policy).toContain(`'nonce-${String(nonce)}'`);
    expect(
      policy
        .split("; ")
        .find((directive) => directive.startsWith("script-src")),
    ).not.toContain("'unsafe-inline'");
    expect(
      first.headers.get("x-middleware-request-content-security-policy"),
    ).toBe(policy);
    expect(second.headers.get("content-security-policy")).not.toBe(policy);
  });

  it("lets Vercel's toolbar through on a preview deployment and nowhere else", () => {
    const policyOn = (environment: string): string => {
      vi.stubEnv("VERCEL_ENV", environment);

      try {
        return (
          proxy(requestFor("/listings")).headers.get(
            "content-security-policy",
          ) ?? ""
        );
      } finally {
        vi.unstubAllEnvs();
      }
    };

    expect(policyOn("preview")).toContain("https://vercel.live");
    expect(policyOn("production")).not.toContain("vercel.live");
  });
});

describe("the proxy's matcher", () => {
  const matches = (url: string, headers?: Record<string, string>): boolean =>
    unstable_doesMiddlewareMatch({ config, nextConfig: {}, url, headers });

  it("covers every page and leaves the BFF and Next's own files alone", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/bookings/abc")).toBe(true);
    expect(matches("/api")).toBe(false);
    expect(matches("/api/bookings")).toBe(false);
    expect(matches("/_next/static/chunk.js")).toBe(false);
  });

  it("excludes the `api` segment rather than every path that starts with it", () => {
    expect(matches("/apiary")).toBe(true);
  });

  it("skips the router's prefetches", () => {
    expect(matches("/listings", { "next-router-prefetch": "1" })).toBe(false);
    expect(matches("/listings", { purpose: "prefetch" })).toBe(false);
  });
});
