import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  REQUEST_ID_HEADER,
} from "@repo/contracts";
import { GET, POST } from "./api-proxy";

/**
 * The request id is the one thing this handler adds to a request rather than copies. What
 * has to hold is that the API, the answer and this handler's own log line all name the
 * same id — always one minted here, never one a browser wrote — including the answer this
 * handler writes when the API never gave one, and the line of a request nobody was left
 * to answer.
 */

const UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[\da-f]{4}-[\da-f]{12}$/;

const requestFor = (
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): NextRequest =>
  new NextRequest(
    new URL("/api/bookings?status=PAID", "http://localhost:3000"),
    { headers, signal },
  );

/** What the API was sent, and an answer that adopts the id the way the API does. */
function stubApi(): () => Headers {
  let sent = new Headers();

  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      sent = new Headers(init.headers);

      return Promise.resolve(
        new Response("[]", {
          status: 200,
          headers: {
            "content-type": "application/json",
            [REQUEST_ID_HEADER]: sent.get(REQUEST_ID_HEADER) ?? "",
          },
        }),
      );
    }),
  );

  return () => sent;
}

/** An API that answers with an event stream and keeps it open. */
function stubEventStream(): () => Headers {
  let sent = new Headers();

  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      sent = new Headers(init.headers);

      return Promise.resolve(
        new Response(new ReadableStream<Uint8Array>(), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    }),
  );

  return () => sent;
}

const apiUnreachable = (): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
  );
};

let lines: string[];

beforeEach(() => {
  vi.stubEnv("API_ORIGIN", "http://api.test");
  vi.stubEnv("NODE_ENV", "production");
  lines = [];
  const capture = (line: string): void => {
    lines.push(line);
  };
  vi.spyOn(console, "info").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const loggedLine = (): Record<string, unknown> => {
  expect(lines).toHaveLength(1);

  return JSON.parse(lines[0] ?? "") as Record<string, unknown>;
};

describe("the BFF's request id", () => {
  it("mints one, sends it to the API, answers with it and logs it", async () => {
    const sent = stubApi();

    const response = await GET(requestFor());
    const id = sent().get(REQUEST_ID_HEADER);

    expect(id).toMatch(UUID);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(id);
    expect(loggedLine()).toMatchObject({
      level: "info",
      msg: "GET /api/bookings 200",
      req: { id, method: "GET", url: "/api/bookings" },
      res: { statusCode: 200 },
    });
  });

  it("drops an id the browser sent, however well-formed", async () => {
    const sent = stubApi();

    const response = await GET(requestFor({ [REQUEST_ID_HEADER]: "trace-42" }));
    const id = sent().get(REQUEST_ID_HEADER);

    expect(id).toMatch(UUID);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(id);
  });

  it("logs Vercel's id of the request beside its own, only when there is one", async () => {
    stubApi();

    await GET(requestFor({ "x-vercel-id": "fra1::iad1::abc-123" }));

    expect(loggedLine()).toMatchObject({ vercelId: "fra1::iad1::abc-123" });

    lines = [];
    await GET(requestFor());

    expect(loggedLine()).not.toHaveProperty("vercelId");
  });

  it("leaves out a Vercel id that is not a short token", async () => {
    stubApi();

    await GET(requestFor({ "x-vercel-id": "x".repeat(129) }));

    expect(loggedLine()).not.toHaveProperty("vercelId");

    lines = [];
    await GET(requestFor({ "x-vercel-id": "fra1 forged=1" }));

    expect(loggedLine()).not.toHaveProperty("vercelId");
  });

  it("names the 502 it writes itself when the API never answered", async () => {
    apiUnreachable();

    const response = await GET(requestFor());
    const id = response.headers.get(REQUEST_ID_HEADER);

    expect(response.status).toBe(502);
    expect(id).toMatch(UUID);
    const line = loggedLine();

    expect(line).toMatchObject({
      level: "error",
      req: { id },
      res: { statusCode: 502 },
    });
    expect(line.res).not.toHaveProperty("aborted");
  });

  it("names the 500 it writes itself when it cannot address the API", async () => {
    vi.stubEnv("API_ORIGIN", "");
    vi.resetModules();
    const { GET: unconfigured } = await import("./api-proxy");

    const response = await unconfigured(requestFor());
    const id = response.headers.get(REQUEST_ID_HEADER);

    expect(response.status).toBe(500);
    expect(id).toMatch(UUID);
    // The reason goes into the request's own line rather than into the answer.
    expect(loggedLine()).toMatchObject({
      level: "error",
      req: { id },
      res: { statusCode: 500 },
      err: { type: "Error", message: expect.stringContaining("API_ORIGIN") },
    });
    expect(await response.text()).not.toContain("API_ORIGIN");
  });

  it("logs a throw on the way with its error, and lets it through", async () => {
    // A session cookie in the answer sends the handler to Next's cookie store, which is
    // not there outside a request — the closest thing to a fault of the proxy itself.
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("{}", {
            status: 200,
            headers: { "set-cookie": `${ACCESS_TOKEN_COOKIE}=token; Path=/` },
          }),
        ),
      ),
    );

    await expect(GET(requestFor())).rejects.toThrow();

    const line = loggedLine();

    expect(line).toMatchObject({
      level: "error",
      req: { id: expect.stringMatching(UUID) },
      res: { statusCode: 500 },
      err: { message: expect.any(String) },
    });
  });

  it("logs the event stream once its headers arrive, and names the stream", async () => {
    const sent = stubEventStream();

    const response = await GET(requestFor());
    const id = sent().get(REQUEST_ID_HEADER);

    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(id);
    // Still open: the line did not wait for the stream to end.
    expect(loggedLine()).toMatchObject({
      level: "info",
      req: { id },
      res: { statusCode: 200 },
    });

    await response.body?.cancel();
  });

  it("writes a short line with the id outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const sent = stubApi();

    await GET(requestFor());

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      new RegExp(
        `^BFF GET /api/bookings 200 \\d+ms ${String(sent().get(REQUEST_ID_HEADER))}$`,
      ),
    );
  });

  it("logs a browser that left as 499, not as the 502 its abort produced", async () => {
    // An API that answers unless the request to it was aborted, as undici's fetch does.
    const fetchMock = vi.fn((_url: string, init: RequestInit) =>
      init.signal?.aborted === true
        ? Promise.reject(new DOMException("aborted", "AbortError"))
        : Promise.resolve(new Response("[]", { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const left = new AbortController();
    left.abort();

    const response = await GET(requestFor({}, left.signal));

    // A browser gone before the handler ran still takes the upstream request with it.
    expect(fetchMock.mock.calls[0]?.[1].signal?.aborted).toBe(true);
    expect(response.status).toBe(502);
    expect(loggedLine()).toMatchObject({
      level: "info",
      res: { statusCode: 499, aborted: true },
    });
  });
});

describe("a refresh without a session cookie", () => {
  const refresh = (headers: Record<string, string> = {}): NextRequest =>
    new NextRequest(new URL("/api/auth/refresh", "http://localhost:3000"), {
      method: "POST",
      headers,
    });

  it("is answered with a 204 here when there is neither cookie, without asking the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(refresh());

    expect(response.status).toBe(204);
    expect(response.headers.get("content-type")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still carries the request id and is logged with its own status", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const response = await POST(refresh());
    const id = response.headers.get(REQUEST_ID_HEADER);

    expect(id).toMatch(UUID);
    expect(loggedLine()).toMatchObject({
      msg: "POST /api/auth/refresh 204",
      req: { id, method: "POST", url: "/api/auth/refresh" },
      res: { statusCode: 204 },
    });
  });

  it("is forwarded with the refresh cookie when it is there", async () => {
    const sent = stubApi();

    const response = await POST(
      refresh({ cookie: `${REFRESH_TOKEN_COOKIE}=token` }),
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      "http://api.test/auth/refresh",
    );
    expect(sent().get("cookie")).toBe(`${REFRESH_TOKEN_COOKIE}=token`);
  });

  it("is forwarded when only an access cookie is left, so the API clears it", async () => {
    const sent = stubApi();

    const response = await POST(
      refresh({ cookie: `${ACCESS_TOKEN_COOKIE}=stale` }),
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(sent().get("cookie")).toBe(`${ACCESS_TOKEN_COOKIE}=stale`);
  });

  it("is not answered here for another method on the same path", async () => {
    stubApi();

    const response = await GET(
      new NextRequest(new URL("/api/auth/refresh", "http://localhost:3000")),
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
