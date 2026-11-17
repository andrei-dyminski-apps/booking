import { REQUEST_TIMEOUT_MS } from "../config";

/** What a cached read stores: the answer as the API gave it, before any of it is believed. */
export type CachedAnswer = {
  status: number;
  contentLength: string | null;
  text: string;
};

/**
 * Where a cached read gets its answer: a `"use cache"` function of the call site, which
 * names the lifetime and the tags and calls `answerOf` inside its scope.
 *
 * The scope is the call site's and not this segment's because it cannot be anything else:
 * a `"use cache"` function may not be part of a module a client component reaches, and
 * this segment is reached from both sides (see the client/server boundary in
 * `apps/web/CLAUDE.md`). The page slices that read the public answers are server-only.
 */
export type AnswerCache = (url: string) => Promise<CachedAnswer>;

/**
 * The request a cached read makes, called inside the call site's `"use cache"` scope — and
 * the reason that scope holds a raw answer rather than a parsed one. What a cached function
 * throws reaches its caller serialized, not as the object that was thrown, so an
 * `ApiResponseError` thrown in there would arrive as a plain `Error` and every `instanceof`
 * above it — `orNotFound`, a stale cursor, the reviews' notice — would stop recognising it.
 * So nothing that can be wrong about an answer is decided in here: the status and the text
 * cross the boundary as plain values, and the transport outside it parses, checks and
 * throws exactly as it does for a read of this request.
 *
 * What is stored is every answer the API stands by — a 2xx, and a 4xx, which is as true of
 * a public read the next time it is asked (a listing that does not exist, a cursor this API
 * will not read). A 5xx and a request that never came back are thrown instead, and a throw
 * is not stored: the next visitor asks again rather than being handed the failure.
 *
 * No session and no client address reach this request, and that is not an omission: the
 * answer is shared with whoever asks next with the same arguments, and `cookies()` is
 * refused inside a cached scope anyway. The URL is one of those arguments, which is why
 * `queryString` sorts it.
 */
export async function answerOf(url: string): Promise<CachedAnswer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status >= 500) {
    throw new Error(`API responded with ${response.status}`);
  }

  return {
    status: response.status,
    contentLength: response.headers.get("content-length"),
    text: await response.text(),
  };
}
