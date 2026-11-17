/**
 * An API that accepts the connection and then says nothing would hold a server render
 * open for the five minutes undici allows it, so the transport gives up first. The abort
 * reaches the caller as a `TimeoutError` out of `fetch`, which is exactly the case
 * `ApiUnreachableError` describes.
 *
 * The price is Next's per-render memoization: a `signal` in the init opts the request out
 * of it, so two components asking for the same booking in one pass make two requests. A
 * cached read — the call site's `"use cache"` scope — is not affected, and a render that
 * never finishes costs more than a duplicated call.
 *
 * Here rather than in `http-client.ts` because the session refresh waits by the same
 * deadline from a module of its own (`session-refresh.ts`), which must not import the
 * transport and the schemas behind it.
 */
export const REQUEST_TIMEOUT_MS = 10_000;
