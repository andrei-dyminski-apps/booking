import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@repo/contracts";

/**
 * The protocol around the stream rather than the stream: how many connections a browser
 * holds, when a refused one is tried again, and what a listener hears first. Each of them
 * has a way to be wrong that only a sequence of answers shows — a reconnect every two
 * seconds against a route that keeps refusing, a second stream per tab — so the browser
 * APIs are faked and driven by hand. Every test imports the module afresh: its state is the
 * tab's, and a test is a tab.
 */

const unreadCount = vi.hoisted(() => vi.fn());

vi.mock("./notifications", () => ({ notificationsApi: { unreadCount } }));

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  accept(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }

  emit(event: ServerEvent): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  /** What a browser does with a `401` or a `500`: gives up for good, without saying which. */
  refuse(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }

  static get live(): FakeEventSource[] {
    return FakeEventSource.instances.filter(
      (source) => source.readyState !== FakeEventSource.CLOSED,
    );
  }
}

/**
 * One exclusive lock with a queue, which is all `navigator.locks` is used for here — and a
 * waiter whose signal aborts leaves the queue with an `AbortError`, as the real one does.
 */
class FakeLocks {
  private held = false;
  private readonly queue: (() => void)[] = [];

  request(
    _name: string,
    options: { signal?: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const run = () => {
        this.held = true;
        void callback().then(() => {
          this.held = false;
          resolve();
          this.queue.shift()?.();
        });
      };

      if (!this.held) {
        run();

        return;
      }

      this.queue.push(run);
      options.signal?.addEventListener(
        "abort",
        () => {
          const index = this.queue.indexOf(run);

          if (index < 0) return;

          this.queue.splice(index, 1);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }
}

const sync = (unread: number, revision: number): ServerEvent => ({
  type: "sync",
  unreadNotifications: unread,
  unreadRevision: revision,
});

const MINUTES = 10 * 60_000;

type Tab = typeof import("./server-events");

/** A tab: the module with state of its own. */
const openTab = async (): Promise<Tab> => {
  vi.resetModules();

  return await import("./server-events");
};

const leaves: (() => void)[] = [];

/** Subscribes `heard` to the tab, and leaves after the test whatever the test left open. */
const listen = (tab: Tab, heard: ServerEvent[] = []): (() => void) => {
  const leave = tab.subscribeToServerEvents((event) => heard.push(event));

  leaves.push(leave);

  return leave;
};

/** Lets the messages between tabs and the pending promises land. */
const settle = async (): Promise<void> => {
  for (let round = 0; round < 5; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

beforeEach(() => {
  FakeEventSource.instances = [];
  unreadCount.mockReset();
  unreadCount.mockResolvedValue({ unread: 0, revision: 0 });
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  for (const leave of leaves.splice(0)) leave();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a tab on its own", () => {
  beforeEach(() => {
    // No Web Locks: every tab holds its own stream, which is the path these tests drive.
    vi.stubGlobal("navigator", {});
  });

  it("shares one stream among its listeners and closes it with the last", async () => {
    const tab = await openTab();
    const leaveFirst = listen(tab);
    const leaveSecond = listen(tab);

    expect(FakeEventSource.live).toHaveLength(1);

    leaveFirst();
    expect(FakeEventSource.live).toHaveLength(1);

    leaveSecond();
    expect(FakeEventSource.live).toHaveLength(0);
  });

  it("starts a late listener with the latest count, and only that listener", async () => {
    const tab = await openTab();
    const first: ServerEvent[] = [];
    const late: ServerEvent[] = [];

    listen(tab, first);

    const [source] = FakeEventSource.instances;

    source?.accept();
    source?.emit(sync(3, 10));
    // Counted earlier, arrived later: the count a newcomer starts from is the newer one.
    source?.emit({ ...sync(1, 5), type: "notifications.read" });

    listen(tab, late);
    await settle();

    expect(late).toEqual([sync(3, 10)]);
    expect(first).toHaveLength(2);
  });

  it("backs off a stream that keeps being refused, even while the API answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    listen(await openTab());

    FakeEventSource.instances.at(-1)?.refuse();
    await settle();
    // One ordinary request, which refreshes the session itself if that was the trouble.
    expect(unreadCount).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    expect(FakeEventSource.instances).toHaveLength(2);

    FakeEventSource.instances.at(-1)?.refuse();
    await settle();
    vi.advanceTimersByTime(2_000);
    expect(FakeEventSource.instances).toHaveLength(2);

    vi.advanceTimersByTime(2_000);
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it("starts the delay over once a connection opens", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    listen(await openTab());

    FakeEventSource.instances.at(-1)?.refuse();
    await settle();
    vi.advanceTimersByTime(2_000);

    // Served for its lifetime, then refused on the way back — a token that lapsed meanwhile.
    FakeEventSource.instances.at(-1)?.accept();
    FakeEventSource.instances.at(-1)?.refuse();
    await settle();
    vi.advanceTimersByTime(2_000);

    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it("does not come back for a tab whose listeners left while it waited", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const leave = listen(await openTab());

    FakeEventSource.instances.at(-1)?.refuse();
    await settle();
    leave();
    vi.advanceTimersByTime(MINUTES);

    expect(FakeEventSource.instances).toHaveLength(1);
  });
});

describe("several tabs", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { locks: new FakeLocks() });
  });

  it("holds one stream for the browser, and hands it over when the leading tab quits", async () => {
    const leader = await openTab();
    const leaderHeard: ServerEvent[] = [];
    const leaveLeader = listen(leader, leaderHeard);

    const follower = await openTab();
    const followerHeard: ServerEvent[] = [];
    const leaveFollower = listen(follower, followerHeard);

    expect(FakeEventSource.live).toHaveLength(1);

    const [stream] = FakeEventSource.instances;

    stream?.accept();
    stream?.emit(sync(2, 1));
    await settle();

    expect(leaderHeard).toEqual([sync(2, 1)]);
    expect(followerHeard).toEqual([sync(2, 1)]);

    leaveLeader();
    await settle();

    // The follower is next in the lock's queue, and opens a stream of its own.
    expect(FakeEventSource.live).toHaveLength(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    leaveFollower();
    await settle();
    expect(FakeEventSource.live).toHaveLength(0);
  });

  it("welcomes a tab that joins late with the count, and nobody else", async () => {
    const leader = await openTab();
    const leaderHeard: ServerEvent[] = [];

    listen(leader, leaderHeard);
    FakeEventSource.instances[0]?.emit(sync(4, 7));

    const first = await openTab();
    const firstHeard: ServerEvent[] = [];

    listen(first, firstHeard);
    await settle();

    const second = await openTab();
    const secondHeard: ServerEvent[] = [];

    listen(second, secondHeard);
    await settle();

    expect(firstHeard).toEqual([sync(4, 7)]);
    expect(secondHeard).toEqual([sync(4, 7)]);
    expect(leaderHeard).toEqual([sync(4, 7)]);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
