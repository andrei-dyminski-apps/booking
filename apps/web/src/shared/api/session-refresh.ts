import { BFF_BASE_PATH, REQUEST_TIMEOUT_MS } from "../config";

/**
 * One refresh at a time, and one for the whole browser rather than one per tab.
 *
 * Rotation burns the token it is given, so several tabs waking up together used to be a
 * queue of requests each spending the successor of the last. The promise below collapses
 * that within a tab; `navigator.locks` — the only mutex a browser has that spans its tabs
 * — collapses it across them.
 *
 * It sits beside the transport rather than with the other session routes because the
 * transport is what has to perform it in the middle of somebody else's request; a
 * `shared/api/auth.ts` that owned it would be imported by the module it imports. And it is
 * a module of its own, outside `http-client.ts`, because the shell runs it on every page
 * (`session-recovery.tsx`): the transport imports the contract's schemas, and with them
 * zod, which a stranger's first load has no other use for.
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

  // Called with `fetch` rather than `apiRequest`, and never retried on a 401: a refused
  // refresh is a dead session, and refreshing to repair it would be endless recursion.
  // The answer is the user, and nothing here parses it — whether the cookies were
  // replaced is the status, which is also why this file needs no schema. What it does
  // check is that the answer is JSON: a 2xx page from something between the browser and
  // this origin (a captive portal, a misconfigured proxy) replaced no cookies, and taking
  // it for a rotation would tell every waiting tab the session is back.
  try {
    const response = await fetch(`${BFF_BASE_PATH}/auth/refresh`, {
      method: "POST",
      credentials: "same-origin",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const rotated =
      response.ok &&
      (response.headers.get("content-type")?.startsWith("application/json") ??
        false);

    // Nothing reads the body, so it is released now rather than whenever the response
    // is collected — it would otherwise hold the connection it arrived on. Not awaited,
    // and its failure swallowed: the cookies arrived with the headers, so a connection
    // that drops while the body streams has not undone the rotation the status reported.
    void response.body?.cancel().catch(() => undefined);

    // Every way this fails means the same thing to the caller: there is no session to
    // repair, and the 401 it was about to receive stands.
    if (!rotated) return false;
  } catch {
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
