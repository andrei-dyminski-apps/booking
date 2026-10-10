import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiRequest, refreshSession } from "./http-client";

/**
 * What is worth a runner here is not "fetch got called" but the two things a reviewer
 * cannot re-check on every change: that a 401 is spent on exactly one refresh and one
 * replay, and that concurrent callers collapse into that one refresh instead of each
 * burning the rotation token of the last. Both only run in the browser, so `window` is
 * stubbed rather than left undefined the way the default node environment leaves it — a
 * plain object is enough, no `jsdom` needed, since nothing here renders.
 */

const REFRESH_MARK_KEY = "booking:session-refreshed-at";

const jsonResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const validUser = {
  id: "9c6f6f1e-6b8b-4b8a-9f2e-8f6b6b8b6b8b",
  name: "User",
  email: "user@example.com",
  role: "USER",
  createdAt: "2026-08-24T00:00:00.000Z",
};

function stubBrowser(): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
} {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };

  vi.stubGlobal("window", { localStorage });
  vi.stubGlobal("navigator", {});

  return localStorage;
}

beforeEach(() => {
  stubBrowser();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiRequest", () => {
  it("parses a 2xx answer with the schema", async () => {
    const schema = z.object({ id: z.number() });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { id: 1 })),
    );

    await expect(
      apiRequest({
        method: "GET",
        path: "/things/1",
        schema,
        read: { cache: "no-store" },
      }),
    ).resolves.toEqual({ id: 1 });
  });

  it("hands z.void() the undefined a 204 carries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );

    await expect(
      apiRequest({ method: "DELETE", path: "/things/1", schema: z.void() }),
    ).resolves.toBeUndefined();
  });

  it("reads the API's error contract off a non-2xx answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(422, {
          statusCode: 422,
          message: "Validation failed",
          errors: [{ path: ["email"], message: "Already registered" }],
        }),
      ),
    );

    await expect(
      apiRequest({
        method: "POST",
        path: "/auth/register",
        schema: z.object({}),
        retryOnUnauthorized: false,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: "Validation failed",
      issues: [{ path: ["email"], message: "Already registered" }],
    });
  });

  it("falls back to the status code when the body is outside the error contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 500 })),
    );

    await expect(
      apiRequest({
        method: "GET",
        path: "/things/1",
        schema: z.object({}),
        retryOnUnauthorized: false,
      }),
    ).rejects.toMatchObject({ status: 500, message: "API responded with 500" });
  });

  it("spends a 401 on one refresh and one replay of the failed request", async () => {
    const schema = z.object({ id: z.number() });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(401, { statusCode: 401, message: "Unauthorized" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, validUser))
      .mockResolvedValueOnce(jsonResponse(200, { id: 1 }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiRequest({
        method: "GET",
        path: "/things/1",
        schema,
        read: { cache: "no-store" },
      }),
    ).resolves.toEqual({ id: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/auth/refresh");
  });

  it("does not retry a 401 from a route that opted out, such as the session's own", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(401, { statusCode: 401, message: "Wrong password" }),
      );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiRequest({
        method: "POST",
        path: "/auth/login",
        schema: z.object({}),
        retryOnUnauthorized: false,
      }),
    ).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws the original 401 when the refresh itself fails", async () => {
    const schema = z.object({ id: z.number() });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(401, { statusCode: 401, message: "Unauthorized" }),
      )
      .mockResolvedValueOnce(
        jsonResponse(401, { statusCode: 401, message: "Dead session" }),
      );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiRequest({ method: "GET", path: "/things/1", schema }),
    ).rejects.toMatchObject({ status: 401, message: "Unauthorized" });

    // The failed refresh, not a third attempt at the original request.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("refreshSession", () => {
  it("collapses concurrent callers into the one rotation in flight", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, validUser));
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      refreshSession(),
      refreshSession(),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports failure, rather than throwing, when the refresh route answers with none", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(401, { statusCode: 401, message: "Dead session" }),
        ),
    );

    await expect(refreshSession()).resolves.toBe(false);
  });

  it("asks a single browser-wide lock before rotating", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, validUser)),
    );

    const request = vi.fn(
      async (_name: string, callback: () => Promise<boolean>) =>
        await callback(),
    );

    vi.stubGlobal("navigator", { locks: { request } });

    await refreshSession();

    expect(request).toHaveBeenCalledWith(
      "booking:session-refresh",
      expect.any(Function),
    );
  });

  it("skips the network call when another tab already rotated while this one queued", async () => {
    const localStorage = stubBrowser();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const request = vi.fn(
      async (_name: string, callback: () => Promise<boolean>) => {
        // What a winning tab leaves behind before this one's turn at the lock arrives.
        localStorage.setItem(REFRESH_MARK_KEY, "written-by-another-tab");
        return await callback();
      },
    );

    vi.stubGlobal("navigator", { locks: { request } });

    await expect(refreshSession()).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
