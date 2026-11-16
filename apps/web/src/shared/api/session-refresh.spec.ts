import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshSession } from "./session-refresh";

/**
 * What is worth a runner here is the invariant a reviewer cannot re-check on every change:
 * concurrent callers, in one tab or several, collapse into a single rotation instead of
 * each burning the token of the last — and a rotation is reported only when one happened.
 * `window`, `navigator.locks` and `localStorage` are stubbed by hand rather than rendered:
 * a plain object is enough, no `jsdom` needed, since nothing here renders.
 */

const REFRESH_MARK_KEY = "booking:session-refreshed-at";

type Storage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

let localStorage: Storage;

function stubBrowser(): Storage {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };

  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("navigator", {});

  return storage;
}

beforeEach(() => {
  localStorage = stubBrowser();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("refreshSession", () => {
  it("collapses concurrent callers into the one rotation in flight", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      refreshSession(),
      refreshSession(),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/auth/refresh");
  });

  it("leaves a mark of the rotation for the tabs queued behind it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));

    await expect(refreshSession()).resolves.toBe(true);
    expect(localStorage.getItem(REFRESH_MARK_KEY)).not.toBeNull();
  });

  it("reports failure, rather than throwing, when the refresh route answers with none", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { statusCode: 401, message: "Dead session" },
            { status: 401 },
          ),
        ),
    );

    await expect(refreshSession()).resolves.toBe(false);
    expect(localStorage.getItem(REFRESH_MARK_KEY)).toBeNull();
  });

  it("reports failure when the request never gets an answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new DOMException("The operation timed out.", "TimeoutError"),
        ),
    );

    await expect(refreshSession()).resolves.toBe(false);
    expect(localStorage.getItem(REFRESH_MARK_KEY)).toBeNull();
  });

  it("does not take a 2xx page from something in between for a rotation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>Sign in to the Wi-Fi</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    await expect(refreshSession()).resolves.toBe(false);
    // No mark either, or a tab waiting for the lock would skip a rotation nobody made.
    expect(localStorage.getItem(REFRESH_MARK_KEY)).toBeNull();
  });

  it("counts a rotation whose body is lost after the headers", async () => {
    // The cookies came with the headers, so the connection dropping afterwards undoes
    // nothing — and the body nobody reads must not turn the rotation into a failure.
    const body = new ReadableStream({
      start(controller) {
        controller.error(new TypeError("network error"));
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(refreshSession()).resolves.toBe(true);
    expect(localStorage.getItem(REFRESH_MARK_KEY)).not.toBeNull();
  });

  it("asks a single browser-wide lock before rotating", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));

    const request = vi.fn(
      async (_name: string, callback: () => Promise<boolean>) =>
        await callback(),
    );

    vi.stubGlobal("navigator", { locks: { request } });

    await refreshSession();

    expect(request).toHaveBeenCalledWith(
      "booking:session-refresh",
      expect.any(Function),
    );
  });

  it("skips the network call when another tab already rotated while this one queued", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const request = vi.fn(
      async (_name: string, callback: () => Promise<boolean>) => {
        // What a winning tab leaves behind before this one's turn at the lock arrives.
        localStorage.setItem(REFRESH_MARK_KEY, "written-by-another-tab");
        return await callback();
      },
    );

    vi.stubGlobal("navigator", { locks: { request } });

    await expect(refreshSession()).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
