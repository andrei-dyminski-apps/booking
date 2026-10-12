import { serverEventSchema, type ServerEvent } from "@repo/contracts";
import { BFF_BASE_PATH } from "../config";
import { notificationsApi } from "./notifications";

/**
 * The browser's end of `GET /events`: **one `EventSource` per browser**, however many tabs
 * and components listen. A connection is not free — over HTTP/1.1 a browser keeps six per
 * origin for all its tabs together, and a stream holds one for good — so a seventh tab, or
 * six of them, would otherwise leave every navigation of the site queued behind streams.
 *
 * - **Within a tab** the first subscriber joins and the last one to leave quits, so a
 *   screen that wants live updates subscribes and never thinks about the connection.
 * - **Across tabs** one of them leads: whoever holds the `navigator.locks` lock opens the
 *   stream and hands every event to the others over a `BroadcastChannel`. The others wait
 *   in the lock's queue, so when the leading tab closes — or its last listener leaves — the
 *   next one is granted the lock and opens a stream of its own, whose opening `sync`
 *   repairs whatever the handover missed. A browser without either API (an insecure
 *   context, an old engine) falls back to a stream per tab.
 *
 * **Every listener starts with a `sync`.** The stream's own opens a connection; a listener
 * that arrives later — a tab joining a leader, a component mounting in a tab already
 * listening — is handed one built from the latest count this tab knows of. So a listener can
 * read its first `sync` as "the state now" and any later one as "there was a gap".
 *
 * It goes through the BFF like every other call, so the session is the first-party cookie
 * and nothing about it is handled here — except the one thing `EventSource` cannot do for
 * itself. It reconnects on its own after a dropped connection, but gives up for good on
 * any answer that is not a `200`, and it never says which. The usual one is a `401`: the
 * API closes every stream after a few minutes precisely so the next one passes the guard
 * again, and by then the access token may have lapsed. So a stream the browser abandoned
 * is answered with one ordinary request — which, if the session needs it, refreshes it the
 * way any request does — and a reconnect after a delay that grows with every failure in a
 * row, whatever the reason: an answer that is not a `401` would never be cured by a refresh.
 *
 * Browser-only by nature; nothing on the server imports a live stream.
 */

export type ServerEventListener = (event: ServerEvent) => void;

const EVENTS_URL = `${BFF_BASE_PATH}/events`;

/** Held by the tab whose stream the browser shares; the others queue for it. */
const LEADER_LOCK = "booking:server-events";

const BROADCAST_CHANNEL = "booking:server-events";

/** The first retry after the browser gave up, doubled per failure in a row up to the ceiling. */
const FIRST_RETRY_MS = 2_000;

/**
 * What a visitor whose session is really gone — or whose API is down — costs: one request
 * this often, until a connection answers again.
 */
const MAX_RETRY_MS = 5 * 60_000;

type Broadcast =
  /** The leader's stream, passed on. */
  | { kind: "event"; event: ServerEvent }
  /** A tab that just joined, asking the leader for the count it would have missed. */
  | { kind: "hello"; from: string }
  /** The leader's answer, to that tab alone — the others have the count already. */
  | { kind: "welcome"; to: string; event: ServerEvent };

/** The count part of an event, which is all a `sync` replayed to a newcomer can carry. */
type Count = Pick<ServerEvent, "unreadNotifications" | "unreadRevision">;

/**
 * Tells a `welcome` for this tab from one for another. Not `crypto.randomUUID`, which an
 * insecure context does not have — and uniqueness among a few tabs is all it needs.
 */
const tabId = Math.random().toString(36).slice(2);
const listeners = new Set<ServerEventListener>();

/** The latest count this tab has heard of, by revision. */
let known: Count | null = null;

let channel: BroadcastChannel | null = null;
/** Aborts the wait for the lock, or ends the leadership once it was granted. */
let membership: AbortController | null = null;

let leading = false;
let source: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let failures = 0;

export function subscribeToServerEvents(
  listener: ServerEventListener,
): () => void {
  listeners.add(listener);

  if (listeners.size === 1) {
    join();
  } else if (known !== null) {
    const opening = syncOf(known);

    // After the caller has its unsubscribe in hand, as an event from the stream would be.
    queueMicrotask(() => {
      if (listeners.has(listener)) listener(opening);
    });
  }

  return () => {
    if (!listeners.delete(listener)) return;

    if (listeners.size === 0) quit();
  };
}

function join(): void {
  const locks = globalThis.navigator?.locks;

  if (locks === undefined || typeof BroadcastChannel === "undefined") {
    lead();

    return;
  }

  const joined = new AbortController();
  const shared = new BroadcastChannel(BROADCAST_CHANNEL);

  membership = joined;
  channel = shared;
  shared.onmessage = (message: MessageEvent<Broadcast>) => {
    onBroadcast(message.data);
  };

  locks
    .request(
      LEADER_LOCK,
      { signal: joined.signal },
      () =>
        new Promise<void>((resolve) => {
          lead();
          // Held until this tab quits; closing the tab releases it by itself.
          joined.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        }),
    )
    // An `AbortError` — the tab quit while it was still waiting its turn.
    .catch(() => undefined);

  shared.postMessage({ kind: "hello", from: tabId } satisfies Broadcast);
}

function quit(): void {
  membership?.abort();
  membership = null;
  channel?.close();
  channel = null;
  leading = false;
  source?.close();
  source = null;

  if (retry !== null) clearTimeout(retry);

  retry = null;
  failures = 0;
  known = null;
}

function lead(): void {
  leading = true;
  open();
}

function onBroadcast(message: Broadcast): void {
  switch (message.kind) {
    case "event":
      if (!leading) deliver(message.event);
      break;
    case "welcome":
      // Late, when the leader's own `sync` crossed the `hello` and got here first.
      if (message.to === tabId && known === null) deliver(message.event);
      break;
    case "hello":
      if (leading && known !== null) {
        channel?.postMessage({
          kind: "welcome",
          to: message.from,
          event: syncOf(known),
        } satisfies Broadcast);
      }
      break;
  }
}

function open(): void {
  retry = null;

  const opened = new EventSource(EVENTS_URL);

  source = opened;

  opened.onopen = () => {
    failures = 0;
  };

  opened.onmessage = (message: MessageEvent<string>) => {
    // Parsed rather than trusted, and allowed to throw: a payload outside the contract is a
    // drift between the two sides, which has to be loud rather than half-applied.
    const event = serverEventSchema.parse(JSON.parse(message.data));

    channel?.postMessage({ kind: "event", event } satisfies Broadcast);
    deliver(event);
  };

  opened.onerror = () => {
    // `CONNECTING` is the browser's own reconnect after a dropped connection, and the
    // `sync` that opens the next one repairs whatever was missed in between.
    if (opened.readyState !== EventSource.CLOSED) return;

    opened.close();

    if (source !== opened) return;

    source = null;
    void recover();
  };
}

/**
 * The browser gave up on the stream, and did not say why. One ordinary request finds out
 * what can be mended: a `401` on it refreshes the session inside the transport, and any
 * other answer is left alone. Either way the reconnect waits longer with every failure in a
 * row — `onopen` is what resets the count, so a stream that keeps refusing while the rest
 * of the API answers backs off like one that is down.
 */
async function recover(): Promise<void> {
  failures += 1;

  await notificationsApi.unreadCount().catch(() => undefined);

  if (!leading || source !== null || retry !== null) return;

  retry = setTimeout(
    open,
    Math.min(FIRST_RETRY_MS * 2 ** (failures - 1), MAX_RETRY_MS),
  );
}

function deliver(event: ServerEvent): void {
  if (known === null || event.unreadRevision >= known.unreadRevision) {
    known = {
      unreadNotifications: event.unreadNotifications,
      unreadRevision: event.unreadRevision,
    };
  }

  for (const listener of listeners) listener(event);
}

function syncOf(count: Count): ServerEvent {
  return { type: "sync", ...count };
}
