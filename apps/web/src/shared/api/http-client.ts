import { z } from "zod";
import {
  ACCESS_TOKEN_COOKIE,
  apiErrorSchema,
  toErrorCode,
  type ApiErrorIssue,
  type ErrorCode,
} from "@repo/contracts";
import {
  apiOrigin,
  BFF_BASE_PATH,
  HTTP_STATUS,
  REQUEST_TIMEOUT_MS,
} from "../config";
import type { AnswerCache } from "./cached-answer";
import { refreshSession } from "./session-refresh";

/**
 * The transport every call to the API goes through: the base URL, the two errors, the
 * parse of the answer and the one retry a dead access token is worth all live here once,
 * so an entity only writes down its own routes.
 */

/** The API never answered: it is down, DNS failed, the proxy could not reach it. */
export class ApiUnreachableError extends Error {
  constructor(cause: unknown) {
    super("API is unreachable", { cause });
    this.name = "ApiUnreachableError";
  }
}

/**
 * The API answered with a non-2xx status. `issues` is non-empty only for a failed
 * validation. `code` names the rule that refused (see `ERROR_CODES` in `@repo/contracts`),
 * so a branch on it is exhaustive over the list. It is `UNKNOWN_ERROR` for a code this build
 * has no word for (an API newer than the site) and for an answer outside the error
 * contract, which has none — either way the status and `message` are what is left to read.
 */
export class ApiResponseError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: readonly ApiErrorIssue[] = [],
    readonly code: ErrorCode = "UNKNOWN_ERROR",
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

/**
 * How a read is cached — a decision of the call site, not a default of this module, hence
 * a mandatory argument rather than an optional one. There are two answers and they differ
 * in more than freshness.
 *
 * `{ cache: "no-store" }` is a read of this request: it carries the visitor's session and
 * address (`serverHeaders`), runs on every render and is never stored. A page that makes
 * one has a part that differs per visitor, which is what a `<Suspense>` is for.
 *
 * `{ cached }` is an answer shared between visitors. `cached` is a `"use cache"` function
 * of the call site that calls `answerOf` — which is where the read's `cacheLife` and
 * `cacheTag` are written, and why the decision stays at the call site. It carries nothing
 * of the visitor's, so a route that needs the session cannot be read this way; asked of
 * one, it answers `401` rather than somebody else's data.
 */
export type ReadOptions = { cache: "no-store" } | { cached: AnswerCache };

type RequestOptions<T> = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  schema: z.ZodType<T>;
  body?: unknown;
  read?: ReadOptions;
  /**
   * Handed the raw answer before it is parsed. The session routes are the only ones with
   * a reason to look: they mirror the API's `Set-Cookie` into this server's own jar, and
   * that header is gone by the time a body has been turned into a `User`.
   */
  onResponse?: (response: Response) => Promise<void>;
  /**
   * Off for the routes of the session itself. A 401 from `/auth/login` is a wrong
   * password and from `/auth/refresh` a dead session — refreshing and trying again would
   * be nonsense in the first case and endless recursion in the second.
   */
  retryOnUnauthorized?: boolean;
  /**
   * The caller's own reason to give up — a search box abandoning the request for what was
   * typed before the last keystroke. It joins the timeout below rather than replacing it,
   * and its abort arrives as `ApiUnreachableError` like the timeout's does: the caller
   * that aborted is the one place that knows to ignore it.
   */
  signal?: AbortSignal;
};

export async function apiRequest<T>(options: RequestOptions<T>): Promise<T> {
  const response = await send(options);

  if (response.ok) return await settle(response, options);

  const error = await toResponseError(response);

  // An expired access token is not a signed-out visitor: the refresh token outlives it by
  // a week. So a 401 in the browser is worth one rotation and one replay — and exactly
  // one, because `refreshSession` reports its failure instead of throwing and the replay
  // is not given a second chance of its own.
  if (!canRetry(error, options)) throw error;
  if (!(await refreshSession())) throw error;

  const retried = await send(options);

  if (!retried.ok) throw await toResponseError(retried);

  return await settle(retried, options);
}

async function send<T>({
  method,
  path,
  body,
  read,
  signal,
}: RequestOptions<T>): Promise<Response> {
  if (read !== undefined && "cached" in read && typeof window === "undefined") {
    return await sendCached(path, read.cached);
  }

  const headers = {
    ...(await serverHeaders()),
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  };

  try {
    return await fetch(`${baseUrl()}${path}`, {
      method,
      // Same-origin now: the browser calls the BFF, so the session is a first-party
      // cookie and travels by default. `include` would still work and would still be
      // describing a topology this application no longer has.
      credentials: "same-origin",
      // Nothing of this request is stored, on either side: an answer that carries the
      // session is the visitor's own.
      cache: "no-store",
      signal: withTimeout(signal),
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) {
    // Only a transport error means the API is not running: any status code is an answer.
    throw new ApiUnreachableError(cause);
  }
}

/**
 * A cached read, answered as if it had just been fetched: the call site's cache hands back
 * the status and the text `answerOf` stored, and they are put back into a `Response` here,
 * so the parse and the errors that follow are the same code a read of this request goes
 * through.
 *
 * The cache throws only when there was nothing worth storing — no answer at all, or a 5xx
 * — and what it throws arrives serialized, its class lost on the way. Both are an API that
 * could not answer this read, which is what the caller is told.
 */
async function sendCached(
  path: string,
  cached: AnswerCache,
): Promise<Response> {
  try {
    const { status, contentLength, text } = await cached(
      `${apiOrigin()}${path}`,
    );

    return new Response(text === "" ? null : text, {
      status,
      headers:
        contentLength === null ? {} : { "content-length": contentLength },
    });
  } catch (cause) {
    throw new ApiUnreachableError(cause);
  }
}

/**
 * The timeout, joined with the caller's own signal where there is one. Joined by hand
 * rather than with `AbortSignal.any`, which Safari only has from 17.4 and Firefox from 124
 * — older than the browsers Next targets, and a `TypeError` there would read as an API
 * that never answers. Either source aborts the request with its own reason, so a timeout
 * still arrives as a `TimeoutError`.
 */
function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  if (signal === undefined) return timeout;

  const joined = new AbortController();

  for (const source of [timeout, signal]) {
    if (source.aborted) {
      joined.abort(source.reason);
      break;
    }

    source.addEventListener("abort", () => joined.abort(source.reason), {
      once: true,
    });
  }

  return joined.signal;
}

/** The browser reaches the API through the proxy of this origin; the server goes direct. */
function baseUrl(): string {
  return typeof window === "undefined" ? apiOrigin() : BFF_BASE_PATH;
}

async function settle<T>(
  response: Response,
  { schema, onResponse }: RequestOptions<T>,
): Promise<T> {
  await onResponse?.(response);

  // The answer is checked with the same schema the backend built it from. The parse is
  // deliberately outside the try in `send`: a drift from the contract has to throw, not
  // disguise itself as an unavailable API.
  if (hasNoBody(response)) return schema.parse(undefined);

  const payload: unknown = await response.json().catch((error: unknown) => {
    // The signal still covers the body: an abort or a timeout while it streams is the same
    // event it is before the headers, and arrives the same way. Anything else — a body
    // that is not JSON — is the drift above and is thrown as it is.
    if (isAbort(error)) throw new ApiUnreachableError(error);

    throw error;
  });

  return schema.parse(payload);
}

/** What `fetch` and a body read throw when their signal fires: the caller's abort or the timeout. */
function isAbort(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function canRetry<T>(
  error: ApiResponseError,
  options: RequestOptions<T>,
): boolean {
  // Only the browser holds a refresh token: it is scoped to the proxied `/auth` path, so
  // a server render is never handed one and has nothing to rotate.
  return (
    typeof window !== "undefined" &&
    error.status === HTTP_STATUS.UNAUTHORIZED &&
    options.retryOnUnauthorized !== false
  );
}

/**
 * What a request made on the server has to carry over from the request Next.js is
 * currently answering. A browser request needs none of it: the cookie is first-party and
 * travels by itself, and the address it comes from is the one the API sees anyway.
 *
 * The session is the first half. A server render has no cookie jar of its own, so the
 * access cookie is copied out by hand. Only that one is there to copy — the refresh
 * cookie is scoped to the `/auth` path of the proxy and never travels with a request for
 * a page, which is why a session that has outlived its access token can only be revived
 * from the browser (see `session-refresh.ts` and the login page).
 *
 * The client address is the second, and it matters because this is the one path that does
 * not go through the BFF: a Server Action and a server render reach Nest directly, so the
 * hop the proxy performs — and with it the `x-forwarded-for` it forwards — never happens.
 * Without this the API sees every visitor arriving from this server's address and buckets
 * them together, which would make the rate limit on `/auth/login` a limit for the whole
 * site rather than for one attacker.
 *
 * A cached read never comes here (`sendCached`). Its answer is stored and served to whoever
 * asks for it next, so attaching one person's credential to it would hand their data to the
 * following visitor — and `cookies()` inside a `"use cache"` scope is refused anyway.
 */
async function serverHeaders(): Promise<HeadersInit> {
  if (typeof window !== "undefined") return {};

  const [{ cookies, headers }, { connection }] = await Promise.all([
    import("next/headers"),
    import("next/server"),
  ]);

  // A read of this request is work of this request, and `connection()` says so to the
  // renders Next.js makes ahead of one — a prefetch of a page, the dev server's check that
  // a navigation is instant. They stop here rather than read on into what only a request
  // may do, such as asking the clock.
  await connection();
  const result: Record<string, string> = {};

  const token = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;

  if (token !== undefined) {
    result.cookie = `${ACCESS_TOKEN_COOKIE}=${token}`;
  }

  // Passed on rather than written: the platform in front of this server is what states the
  // client address, and a value invented here would be one more entry `TRUST_PROXY` has to
  // believe. An absent header means nothing is in front, and then the socket address the
  // API already sees is the right answer.
  const forwardedFor = (await headers()).get("x-forwarded-for");

  if (forwardedFor !== null) {
    result["x-forwarded-for"] = forwardedFor;
  }

  return result;
}

/**
 * 204 and 205 are defined to carry no body at all, and a proxy may state a zero length
 * instead of either. `response.json()` throws on all three, so the schema is handed the
 * `undefined` that the `z.void()` of a deleting route expects.
 */
function hasNoBody(response: Response): boolean {
  return (
    response.status === HTTP_STATUS.NO_CONTENT ||
    response.status === HTTP_STATUS.RESET_CONTENT ||
    response.headers.get("content-length") === "0"
  );
}

async function toResponseError(response: Response): Promise<ApiResponseError> {
  const payload: unknown = await response.json().catch(() => null);
  const parsed = apiErrorSchema.safeParse(payload);

  // A body outside the error contract carries nothing worth showing, but the status is
  // still an answer — so this stays a plain response error rather than a parse failure.
  if (!parsed.success) {
    return new ApiResponseError(
      response.status,
      `API responded with ${response.status}`,
    );
  }

  return new ApiResponseError(
    response.status,
    parsed.data.message,
    parsed.data.errors ?? [],
    toErrorCode(parsed.data.code),
  );
}

/**
 * The query string of a read, and part of the key a cached read is stored under (the URL
 * is the argument of the call site's `"use cache"` scope) — which is why the parameters are sorted rather than left in the order the object
 * happened to carry them. Two callers asking the same question have to produce the same
 * URL, or each of them warms a cache entry the other never reads.
 *
 * An absent filter is left out entirely rather than sent empty. The contract reads `from=`
 * as the absence it means, so either spelling is answered the same way — but they are two
 * different URLs, and this is the side that decides which of them the cache is keyed by.
 */
export function queryString(
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();

  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;

    search.set(name, String(value));
  }

  search.sort();

  const query = search.toString();

  return query === "" ? "" : `?${query}`;
}
