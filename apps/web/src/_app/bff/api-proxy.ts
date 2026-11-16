import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  CLIENT_CLOSED_REQUEST,
  REFRESH_TOKEN_COOKIE,
  REQUEST_ID_HEADER,
  REQUEST_ID_PATTERN,
  type ApiError,
} from "@repo/contracts";
import { mirrorSessionCookies } from "#shared/api";
import { apiOrigin, BFF_BASE_PATH, HTTP_STATUS } from "#shared/config";
import { logRequest } from "./request-log";

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
 * validation stay with Nest — this forwards a request and re-scopes two cookies. The one
 * answer it gives on its own is a refresh with no session cookie at all, which the API
 * could only refuse (`isRefreshWithoutSession`).
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

/**
 * Nothing else of the incoming request is repeated upstream — see `upstreamHeaders`. The
 * request id is not on the list: `handle` mints it rather than copying the browser's.
 */
const FORWARDED_HEADERS = ["accept", "content-type", "x-forwarded-for"];

/**
 * Vercel's own name for the request, which finds it in the platform's logs. Logged beside
 * the id rather than used as it: its format is not documented, nothing says Vercel
 * replaces one a client sent, and outside Vercel it is not there at all. For the same
 * reason it is logged only in the shape of `REQUEST_ID_PATTERN`, the one the API asks of
 * an id it adopts, rather than at whatever length it arrived.
 */
const VERCEL_ID_HEADER = "x-vercel-id";

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

/**
 * Every request is named here before it is forwarded, always with a fresh id: the API
 * adopts it, logs it on every line of the request, and the answer carries it — the 502 and
 * 500 this handler writes itself included, when no line of the API's exists. An
 * `x-request-id` the browser sent is dropped rather than kept. The browser has no use for
 * naming its own requests — it reads the id off the answer — and a kept one would let
 * anybody file their request under somebody else's id in both logs.
 *
 * The line is written whatever happens, a throw included: Next then answers its own 500,
 * which carries no id, and this line — with the error as its `err` — is the only record of
 * which request it was. The `500` of an unset `API_ORIGIN` carries its reason the same
 * way, so a failure of the proxy is one line found by its id, not a second one beside it.
 */
async function handle(request: NextRequest): Promise<Response> {
  const startedAt = performance.now();
  const id = crypto.randomUUID();
  let status: number = HTTP_STATUS.INTERNAL_SERVER_ERROR;
  let error: unknown;

  try {
    let target: string | null = null;

    try {
      target = upstreamUrl(request);
    } catch (cause) {
      error = cause;
    }

    const response =
      target === null
        ? misconfigured()
        : isRefreshWithoutSession(request)
          ? noSession()
          : await forward(request, target, id);

    response.headers.set(REQUEST_ID_HEADER, id);
    status = response.status;

    return response;
  } catch (thrown) {
    error = thrown;

    throw thrown;
  } finally {
    logRequest({
      id,
      method: request.method,
      path: request.nextUrl.pathname,
      // The event stream is logged once its headers arrive, not when the tab closes it.
      status: request.signal.aborted ? CLIENT_CLOSED_REQUEST : status,
      durationMs: performance.now() - startedAt,
      vercelId: vercelIdOf(request),
      error,
    });
  }
}

/**
 * A refresh from a browser with no session cookie at all can only be refused, and the
 * shell asks it of every stranger once per visit. Answered here with a 2xx, because a 401
 * is what the browser writes to its console as an error — and what Lighthouse then
 * reports against every public page. The answer is not JSON, which is the signal
 * `refreshSession` reads as "no session was restored".
 *
 * Only with neither cookie. The API's refused refresh also clears the session cookies,
 * and an access cookie left behind without its refresh cookie would keep `proxy.ts`
 * letting the browser into protected pages until it expired — so that request still goes
 * to the API, which clears it.
 */
function isRefreshWithoutSession(request: NextRequest): boolean {
  return (
    request.method === "POST" &&
    request.nextUrl.pathname === `${BFF_BASE_PATH}/auth/refresh` &&
    !request.cookies.has(REFRESH_TOKEN_COOKIE) &&
    !request.cookies.has(ACCESS_TOKEN_COOKIE)
  );
}

function noSession(): NextResponse {
  return new NextResponse(null, { status: HTTP_STATUS.NO_CONTENT });
}

/** Throws when `API_ORIGIN` is unset — see `misconfigured`. */
function upstreamUrl(request: NextRequest): string {
  const { pathname, search } = request.nextUrl;

  return `${apiOrigin()}${pathname.slice(BFF_BASE_PATH.length)}${search}`;
}

async function forward(
  request: NextRequest,
  target: string,
  id: string,
): Promise<NextResponse> {
  const upstreamSignal = new AbortController();
  const deadline = setTimeout(() => {
    upstreamSignal.abort(
      new DOMException("The API did not answer in time", "TimeoutError"),
    );
  }, UPSTREAM_TIMEOUT_MS);

  // A browser that goes away takes its upstream request with it — for an ordinary request
  // that saves a little, for the event stream it is the only thing that ever closes it. A
  // signal already aborted fires no event, so that case is checked rather than listened for.
  if (request.signal.aborted) {
    upstreamSignal.abort(request.signal.reason);
  } else {
    request.signal.addEventListener(
      "abort",
      () => upstreamSignal.abort(request.signal.reason),
      { once: true },
    );
  }

  try {
    let upstream: Response;

    try {
      upstream = await fetch(target, {
        method: request.method,
        headers: upstreamHeaders(request, id),
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

function vercelIdOf(request: NextRequest): string | null {
  const value = request.headers.get(VERCEL_ID_HEADER);

  return value !== null && REQUEST_ID_PATTERN.test(value) ? value : null;
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
 *
 * `x-request-id` is the id `handle` minted, so the API's lines carry the one this handler
 * logs and the browser is answered with.
 */
function upstreamHeaders(request: NextRequest, id: string): Headers {
  const headers = new Headers({ [REQUEST_ID_HEADER]: id });

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

    // The API's transport policy is for the API's host. Passed on, its `includeSubDomains`
    // would decide HTTPS for every subdomain of wherever this application is deployed —
    // that is this origin's hosting to say, not an answer of somebody else's.
    if (name === "strict-transport-security") continue;

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
    code: "BAD_GATEWAY",
  };

  return NextResponse.json(body, { status: HTTP_STATUS.BAD_GATEWAY });
}

/**
 * The other way this handler fails, and a separate answer because it is a separate fault:
 * `apiOrigin()` throws when `API_ORIGIN` is unset, and the API was then never asked at all.
 * Calling that a 502 would send whoever reads it looking at the wrong service.
 *
 * The reason is logged rather than returned — `handle` puts it into the request's line as
 * its `err`. `apiOrigin()` names the variable it is missing, which is exactly what an
 * operator needs and exactly what a browser has no business being told about this
 * server's environment.
 */
function misconfigured(): NextResponse {
  const body: ApiError = {
    statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    message: "The proxy is not configured",
    error: "Internal Server Error",
    code: "INTERNAL_ERROR",
  };

  return NextResponse.json(body, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
}
