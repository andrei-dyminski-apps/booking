import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AnswerCache } from "./cached-answer";
import {
  ApiResponseError,
  ApiUnreachableError,
  apiRequest,
} from "./http-client";
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
          code: "VALIDATION_FAILED",
          errors: [
            {
              path: ["email"],
              message: "Already registered",
              code: "EMAIL_ALREADY_REGISTERED",
            },
          ],
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
      code: "VALIDATION_FAILED",
      issues: [
        {
          path: ["email"],
          message: "Already registered",
          code: "EMAIL_ALREADY_REGISTERED",
        },
      ],
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
    ).rejects.toMatchObject({
      status: 500,
      message: "API responded with 500",
      code: "UNKNOWN_ERROR",
    });
  });

  it("reads a code this build does not know as unknown, keeping the sentence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          statusCode: 409,
          message: "A rule from a newer API",
          code: "A_RULE_FROM_A_NEWER_API",
        }),
      ),
    );

    await expect(
      apiRequest({
        method: "GET",
        path: "/things/1",
        schema: z.object({}),
        retryOnUnauthorized: false,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "A rule from a newer API",
      code: "UNKNOWN_ERROR",
    });
  });

  it("spends a 401 on one refresh and one replay of the failed request", async () => {
    const schema = z.object({ id: z.number() });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(401, {
          statusCode: 401,
          message: "Unauthorized",
          code: "UNAUTHORIZED",
        }),
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
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, {
        statusCode: 401,
        message: "Wrong password",
        code: "INVALID_CREDENTIALS",
      }),
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
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, {
        statusCode: 401,
        message: "Unauthorized",
        code: "UNAUTHORIZED",
      }),
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

/**
 * A cached read runs on the server only, so `window` is taken away again. Its answer comes
 * from the call site's `"use cache"` scope as plain values, and what has to hold is that
 * the transport reads those exactly as it reads a response it fetched itself — the errors
 * a caller tells apart by their class included, since a class does not survive the cache.
 */
describe("apiRequest with a cached read", () => {
  const ORIGIN = "http://api.test";

  beforeEach(() => {
    vi.stubGlobal("window", undefined);
    vi.stubEnv("API_ORIGIN", ORIGIN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const cachedRead = (cached: AnswerCache) =>
    apiRequest({
      method: "GET",
      path: "/things/1",
      schema: z.object({ id: z.number() }),
      read: { cached },
    });

  it("asks the cache for the API's own URL and parses what it stored", async () => {
    const fetchMock = vi.fn();
    const cached = vi.fn<AnswerCache>().mockResolvedValue({
      status: 200,
      contentLength: null,
      text: JSON.stringify({ id: 1 }),
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(cachedRead(cached)).resolves.toEqual({ id: 1 });
    expect(cached).toHaveBeenCalledWith(`${ORIGIN}/things/1`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a stored refusal as the response error it was, code and all", async () => {
    const cached = vi.fn<AnswerCache>().mockResolvedValue({
      status: 404,
      contentLength: null,
      text: JSON.stringify({
        statusCode: 404,
        message: "Listing not found",
        code: "LISTING_NOT_FOUND",
      }),
    });

    const error: unknown = await cachedRead(cached).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ApiResponseError);
    expect(error).toMatchObject({ status: 404, code: "LISTING_NOT_FOUND" });
  });

  it("reads a cache that threw as an API that could not answer", async () => {
    const cached = vi
      .fn<AnswerCache>()
      .mockRejectedValue(new Error("API responded with 503"));

    await expect(cachedRead(cached)).rejects.toBeInstanceOf(
      ApiUnreachableError,
    );
  });

  it("hands z.void() the undefined of a stored empty answer", async () => {
    const cached = vi
      .fn<AnswerCache>()
      .mockResolvedValue({ status: 204, contentLength: null, text: "" });

    await expect(
      apiRequest({
        method: "GET",
        path: "/things/1",
        schema: z.void(),
        read: { cached },
      }),
    ).resolves.toBeUndefined();
  });
});
