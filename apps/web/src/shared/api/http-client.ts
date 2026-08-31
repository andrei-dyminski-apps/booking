import { z } from "zod";
import {
  ACCESS_TOKEN_COOKIE,
  apiErrorSchema,
  userSchema,
  type ApiErrorIssue,
} from "@repo/contracts";
import { apiOrigin, BFF_BASE_PATH, HTTP_STATUS } from "../config";

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

/** The API answered with a non-2xx status. `issues` is non-empty only for a failed validation. */
export class ApiResponseError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: readonly ApiErrorIssue[] = [],
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

/**
 * Caching of a read is a decision of the call site, not a default of this module —
 * hence a mandatory argument rather than an optional one.
 *
 * `revalidate` is mandatory too, and that is not symmetry for its own sake. A `fetch` has
 * not been cached by default since Next 15, and tags alone do not opt one back in: the
 * decision is read off `cache` and `revalidate`, and a request that names neither is
 * turned into a `no-store` with its tags attached to nothing. `{ next: { tags } }` is
 * therefore a spelling that looks like caching and is not, and the mutation invalidating
 * that tag has nothing to invalidate — a mistake nothing reports, because it fails by
 * being fresh. `false` is what a read whose only invalidation is its tag says.
 */
export type ReadOptions =
  | { cache: RequestCache }
  | { next: { revalidate: number | false; tags?: string[] } };

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
};

/**
 * An API that accepts the connection and then says nothing would hold a server render
 * open for the five minutes undici allows it, so the transport gives up first. The abort
 * reaches the caller as a `TimeoutError` out of `fetch`, which is exactly the case
 * `ApiUnreachableError` describes.
 *
 * The price is Next's per-render memoization: a `signal` in the init opts the request out
 * of it, so two components asking for the same booking in one pass make two requests. The
 * Data Cache — the decision `read` carries from the call site — is not affected, and a
 * render that never finishes costs more than a duplicated call.
 */
const REQUEST_TIMEOUT_MS = 10_000;

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

/**
 * One refresh at a time, and one for the whole browser rather than one per tab.
 *
 * Rotation burns the token it is given, so several tabs waking up together used to be a
 * queue of requests each spending the successor of the last. The promise below collapses
 * that within a tab; `navigator.locks` — the only mutex a browser has that spans its tabs
 * — collapses it across them.
 *
 * It lives with the transport rather than with the other session routes because the
 * transport is what has to perform it in the middle of somebody else's request; a
 * `shared/api/auth.ts` that owned it would be imported by the module it imports.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= runRefresh().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

const SESSION_REFRESH_LOCK = "booking:session-refresh";
const REFRESH_MARK_KEY = "booking:session-refreshed-at";

let refreshInFlight: Promise<boolean> | null = null;

async function runRefresh(): Promise<boolean> {
  const locks = globalThis.navigator?.locks;
  // Read before the wait and compared after it. The mark is not evidence that a rotation
  // happened recently — it is evidence that one happened *while this call was queued*,
  // which is the only reading that survives a logout: cookies can be thrown away without
  // the mark going with them, and a mark trusted on its own would then report a session
  // that no longer exists. Sampling it here is what dates it to this attempt.
  const before = readRefreshMark();

  // An insecure context or an old browser has no Web Locks. The promise above still keeps
  // this tab honest, and what a second tab then costs is an extra rotation rather than a
  // broken session: the API burns the token it is handed and the next tab spends its
  // successor.
  if (locks === undefined) return await attemptRefresh(before);

  // The lib types the callback's result as the value of the lock, so the promise it
  // hands back is one layer deeper than it looks.
  return await locks.request(
    SESSION_REFRESH_LOCK,
    async () => await attemptRefresh(before),
  );
}

async function attemptRefresh(before: string | null): Promise<boolean> {
  // Whoever held the lock while this call waited for it has already replaced the cookies,
  // and the request behind it only needs to be retried. The cookie itself cannot be
  // consulted — it is httpOnly — so the winner leaves a mark where the others can see it.
  // An unchanged mark means nobody did, however recent it looks.
  if (readRefreshMark() !== before) return true;

  try {
    await apiRequest({
      method: "POST",
      path: "/auth/refresh",
      schema: userSchema,
      retryOnUnauthorized: false,
    });
  } catch {
    // Every way this fails means the same thing to the caller: there is no session to
    // repair, and the 401 it was about to receive stands.
    return false;
  }

  markRefreshed();

  return true;
}

function readRefreshMark(): string | null {
  try {
    return window.localStorage.getItem(REFRESH_MARK_KEY);
  } catch {
    // A browser that refuses storage costs one redundant rotation, not a session: the two
    // reads then agree on `null` and this call rotates for itself.
    return null;
  }
}

function markRefreshed(): void {
  try {
    // Only ever compared for equality, so what it has to be is different from the last
    // one rather than a time. Two rotations in the same millisecond would otherwise read
    // as none, and the cost of that is one more rotation — the case the mark exists to
    // spare, spent on the case it cannot see.
    window.localStorage.setItem(
      REFRESH_MARK_KEY,
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  } catch {
    // Same trade as above.
  }
}

async function send<T>({
  method,
  path,
  body,
  read,
}: RequestOptions<T>): Promise<Response> {
  const headers = {
    ...(await serverHeaders(read)),
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  };

  try {
    return await fetch(`${baseUrl()}${path}`, {
      method,
      // Same-origin now: the browser calls the BFF, so the session is a first-party
      // cookie and travels by default. `include` would still work and would still be
      // describing a topology this application no longer has.
      credentials: "same-origin",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...read,
    });
  } catch (cause) {
    // Only a transport error means the API is not running: any status code is an answer.
    throw new ApiUnreachableError(cause);
  }
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

  const payload: unknown = await response.json();

  return schema.parse(payload);
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
 * from the browser (see `refreshSession` above and the login page).
 *
 * The client address is the second, and it matters because this is the one path that does
 * not go through the BFF: a Server Action and a server render reach Nest directly, so the
 * hop the proxy performs — and with it the `x-forwarded-for` it forwards — never happens.
 * Without this the API sees every visitor arriving from this server's address and buckets
 * them together, which would make the rate limit on `/auth/login` a limit for the whole
 * site rather than for one attacker.
 *
 * A cached read is left out of both deliberately. Its answer goes into Next's Data Cache
 * under the URL and is then served to whoever asks for it next, so attaching one person's
 * credential to it would hand their data to the following visitor. It keeps the reads that
 * need no session out of `cookies()` as well, and with it out of dynamic rendering.
 */
async function serverHeaders(
  read: ReadOptions | undefined,
): Promise<HeadersInit> {
  if (typeof window !== "undefined" || isCached(read)) return {};

  const { cookies, headers } = await import("next/headers");
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

/** A mutation carries no `read` and is never cached; the rest say so themselves. */
function isCached(read: ReadOptions | undefined): boolean {
  if (read === undefined) return false;

  return "cache" in read
    ? read.cache !== "no-store"
    : read.next.revalidate !== 0;
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
  );
}

/**
 * The query string of a read, and the second half of the Data Cache key it is stored
 * under — which is why the parameters are sorted rather than left in the order the object
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
