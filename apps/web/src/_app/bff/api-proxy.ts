import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  type ApiError,
} from "@repo/contracts";
import { mirrorSessionCookies } from "#shared/api";
import { apiOrigin, BFF_BASE_PATH, HTTP_STATUS } from "#shared/config";

/**
 * The backend for frontend: everything the browser sends to the API goes through this
 * origin first, and only this file ever speaks to Nest on its behalf.
 *
 * It exists for the session. The frontend is deployed to Vercel and the API to Railway,
 * which are different sites however the domains are arranged — and a preview deployment
 * on a throwaway `*.vercel.app` hostname is a different site again. A cookie that has to
 * cross that boundary needs `SameSite=None`, which Safari's tracking prevention drops and
 * the other browsers are following. Behind this handler the question does not arise: the
 * browser holds a first-party cookie for this origin, and the fact that the answer is
 * fetched from somewhere else is not its business.
 *
 * Three things follow for free. There is no CORS to configure, because there is no
 * cross-origin request left to configure it for. `AUTH_COOKIE_DOMAIN` stops being a
 * concern of the frontend, because the browser never sees the API's own cookies. And the
 * address of the API stops being a build-time constant baked into the bundle, because it
 * is only ever read here, on the server.
 *
 * What it deliberately does not do is decide anything. Authentication, authorization and
 * validation stay with Nest — this forwards a request and re-scopes two cookies.
 */

/**
 * Only the four the transport can spell. A method that `apiRequest` cannot produce has no
 * business reaching the API through a proxy this application wrote for it.
 */
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;

/**
 * Shorter than the ten seconds the browser gives this handler, so a stalled API is
 * reported as a 502 by the side that knows why rather than aborted by the side that does
 * not. The event stream is the exception: the deadline covers its headers only.
 */
const UPSTREAM_TIMEOUT_MS = 9_000;

/**
 * Headers that describe one hop and must not be copied onto the next. `content-encoding`
 * and `content-length` are on the list for a reason of their own: undici has already
 * decoded the body by the time it is read here, so passing on the encoding it arrived in
 * would leave the browser trying to gunzip plain JSON.
 */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Nothing else of the incoming request is repeated upstream — see `upstreamHeaders`. */
const FORWARDED_HEADERS = ["accept", "content-type", "x-forwarded-for"];

/**
 * Statuses defined to carry no body at all. `Response` refuses one that does, and an
 * empty buffer still counts as one — so a `DELETE` answered with 204 has to be rebuilt
 * with a body of `null` rather than with the nothing it arrived with.
 */
const NULL_BODY_STATUSES = new Set<number>([
  HTTP_STATUS.NO_CONTENT,
  HTTP_STATUS.RESET_CONTENT,
  HTTP_STATUS.NOT_MODIFIED,
]);

async function handle(request: NextRequest): Promise<Response> {
  const { pathname, search } = request.nextUrl;

  let target: string;

  try {
    target = `${apiOrigin()}${pathname.slice(BFF_BASE_PATH.length)}${search}`;
  } catch (cause) {
    return misconfigured(cause);
  }

  const upstreamSignal = new AbortController();
  const deadline = setTimeout(() => {
    upstreamSignal.abort(
      new DOMException("The API did not answer in time", "TimeoutError"),
    );
  }, UPSTREAM_TIMEOUT_MS);

  // A browser that goes away takes its upstream request with it — for an ordinary request
  // that saves a little, for the event stream it is the only thing that ever closes it.
  request.signal.addEventListener(
    "abort",
    () => upstreamSignal.abort(request.signal.reason),
    { once: true },
  );

  try {
    let upstream: Response;

    try {
      upstream = await fetch(target, {
        method: request.method,
        headers: upstreamHeaders(request),
        body: await upstreamBody(request),
        // This proxy answers for a person, never for the next person to ask the same thing.
        cache: "no-store",
        // A redirect is an answer the browser is entitled to see, not something to follow
        // on its behalf against a host it does not know about.
        redirect: "manual",
        signal: upstreamSignal.signal,
      });
    } catch {
      return unreachable();
    }

    // Before the headers are copied, and before they are dropped with the rest of them: the
    // session belongs to this origin now, so it is taken out of the answer rather than
    // passed through it.
    await mirrorSessionCookies(upstream);

    // The one answer that is never finished: the deadline covered its headers and stops
    // there, and the body is handed on as it arrives rather than buffered — see
    // `isEventStream`.
    if (isEventStream(upstream)) {
      clearTimeout(deadline);

      return new NextResponse(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: downstreamHeaders(upstream),
      });
    }

    let body: ArrayBuffer | null;

    try {
      body = await downstreamBody(upstream);
    } catch {
      // The deadline covers the body as well as the headers, as the timeout did before it.
      return unreachable();
    }

    return new NextResponse(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: downstreamHeaders(upstream),
    });
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * `GET /events` — Server-Sent Events, which is why this proxy streams at all. Every other
 * answer is a small JSON body read whole; this one stays open for minutes and is useful
 * only line by line, so buffering it would deliver nothing, and the deadline above would
 * cut it off after nine seconds.
 *
 * The API marks the stream `Cache-Control: no-transform`, and the header is passed on
 * like the rest: it is what keeps the compression of `next start` from holding the lines
 * back to fill a gzip block.
 */
function isEventStream(upstream: Response): boolean {
  return (
    upstream.ok &&
    upstream.body !== null &&
    (upstream.headers.get("content-type") ?? "").startsWith("text/event-stream")
  );
}

/**
 * A deliberate allow-list rather than the incoming headers minus a few.
 *
 * The cookie header is rebuilt from the two names of the contract, so the API is handed
 * the session and nothing else this origin happens to have collected. The path scope is
 * what makes that meaningful: a request to `/api/bookings` arrives without the refresh
 * token, so the credential that mints sessions is not forwarded to a route that has no
 * use for it.
 *
 * `x-forwarded-for` is passed on because the API's rate limiter buckets by client
 * address, and without it every visitor would arrive from this server's address and share
 * one bucket.
 *
 * Passed on and not appended to, which is the part worth stating plainly: this handler
 * adds no entry of its own, so it does not raise the number `TRUST_PROXY` names. What
 * raises it is the proxy in front of the API, which sees this server as an ordinary client
 * and appends its address on the right. Since the API counts entries from the right, a
 * value a client invented can only ever sit further left than the entries it trusts —
 * provided that number is not larger than the proxies that really append. It is that
 * number, not this line, that decides whether the header is forgeable.
 */
function upstreamHeaders(request: NextRequest): Headers {
  const headers = new Headers();

  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);

    if (value !== null) headers.set(name, value);
  }

  const session = [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]
    .map((name) => request.cookies.get(name))
    .filter((cookie) => cookie !== undefined)
    .map((cookie) => `${cookie.name}=${cookie.value}`);

  if (session.length > 0) headers.set("cookie", session.join("; "));

  return headers;
}

/**
 * Buffered rather than streamed. Every request this API takes is a small JSON body, and
 * a stream would have to carry `duplex: "half"` through a type that does not describe it
 * for no gain worth the exception.
 */
async function upstreamBody(request: NextRequest): Promise<ArrayBuffer | null> {
  if (request.method === "GET" || request.body === null) return null;

  const body = await request.arrayBuffer();

  return body.byteLength === 0 ? null : body;
}

async function downstreamBody(upstream: Response): Promise<ArrayBuffer | null> {
  if (NULL_BODY_STATUSES.has(upstream.status)) return null;

  return await upstream.arrayBuffer();
}

function downstreamHeaders(upstream: Response): Headers {
  const headers = new Headers();

  for (const [name, value] of upstream.headers) {
    if (HOP_BY_HOP_HEADERS.has(name)) continue;

    // The session has already been re-issued for this origin; the originals are scoped to
    // the API's host and would be refused by the browser anyway.
    if (name === "set-cookie") continue;

    headers.set(name, value);
  }

  return headers;
}

/**
 * The error contract is what the transport parses, so a failure of the proxy itself is
 * described in it too — otherwise a browser would be told "API responded with 502" by the
 * fallback branch of `toResponseError` while the server knows exactly what happened.
 */
function unreachable(): NextResponse {
  const body: ApiError = {
    statusCode: HTTP_STATUS.BAD_GATEWAY,
    message: "The API did not answer",
    error: "Bad Gateway",
  };

  return NextResponse.json(body, { status: HTTP_STATUS.BAD_GATEWAY });
}

/**
 * The other way this handler fails, and a separate answer because it is a separate fault:
 * `apiOrigin()` throws when `API_ORIGIN` is unset, and the API was then never asked at all.
 * Calling that a 502 would send whoever reads it looking at the wrong service.
 *
 * The reason is logged rather than returned. `apiOrigin()` names the variable it is
 * missing, which is exactly what an operator needs and exactly what a browser has no
 * business being told about this server's environment.
 */
function misconfigured(cause: unknown): NextResponse {
  console.error("The BFF cannot address the API:", cause);

  const body: ApiError = {
    statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    message: "The proxy is not configured",
    error: "Internal Server Error",
  };

  return NextResponse.json(body, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
}
