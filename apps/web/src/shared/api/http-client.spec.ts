import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiRequest } from "./http-client";
import { refreshSession } from "./session-refresh";

/**
 * What is worth a runner here is not "fetch got called" but the rule a reviewer cannot
 * re-check on every change: that a 401 is spent on exactly one refresh and one replay.
 * The refresh itself is `session-refresh.ts`'s and has its own spec, so here it is a mock
 * whose answer each case picks. The retry only runs in the browser, so `window` is
 * stubbed rather than left undefined the way the default node environment leaves it — a
 * plain object is enough, no `jsdom` needed, since nothing here renders.
 */

vi.mock("./session-refresh", () => ({ refreshSession: vi.fn() }));

const jsonResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.mocked(refreshSession).mockReset();
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
      .mockResolvedValueOnce(jsonResponse(200, { id: 1 }));

    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(refreshSession).mockResolvedValue(true);

    await expect(
      apiRequest({
        method: "GET",
        path: "/things/1",
        schema,
        read: { cache: "no-store" },
      }),
    ).resolves.toEqual({ id: 1 });

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("throws the original 401 when the refresh itself fails", async () => {
    const schema = z.object({ id: z.number() });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(401, { statusCode: 401, message: "Unauthorized" }),
      );

    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(refreshSession).mockResolvedValue(false);

    await expect(
      apiRequest({ method: "GET", path: "/things/1", schema }),
    ).rejects.toMatchObject({ status: 401, message: "Unauthorized" });

    // One refresh asked for, and no second attempt at the original request.
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
