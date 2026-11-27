import type { PushSubscriptionInput } from "@repo/contracts";

const PUSH_REGISTRATION_KEY = "staydesk:push-registration";
// sw.js uses the same lock and cache name to serialize showing and clearing notifications.
const DEVICE_PUSH_LOCK = "staydesk:device-push";
const PUSH_DISABLED_CACHE = "staydesk-push-disabled";
const PUSH_DEVICE_CACHE = "staydesk-push-device-v1";
const PUSH_DEVICE_URL = "/push-device-registration";
const PUSH_REMOVALS_CACHE = "staydesk-push-removals";
const DEVICE_PUSH_CHANGED = "staydesk:device-push-changed";

/**
 * How often a window's focus may ask for a fresh read of this device's push. A read is an API
 * request or two, and the shell and the profile both listen; a change in another tab or from
 * the worker still arrives at once, through its own event.
 */
export const DEVICE_PUSH_FOCUS_INTERVAL_MS = 60_000;

let deviceOperation: Promise<unknown> = Promise.resolve();

export async function withDevicePushLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (navigator.locks)
    return await navigator.locks.request(DEVICE_PUSH_LOCK, operation);

  const result = deviceOperation.then(operation);
  deviceOperation = result.catch(() => undefined);

  return result;
}

/**
 * Calls `refresh` whenever this device's push state may have changed. `focusIntervalMs`
 * spaces out the refreshes a window's focus asks for — the one trigger that fires on every
 * switch between windows and changes nothing by itself; the caller's own first refresh
 * counts as the latest.
 */
export function watchDevicePush(
  refresh: () => void,
  { focusIntervalMs = 0 }: { focusIntervalMs?: number } = {},
): () => void {
  let focusedAt = Date.now();

  const focused = () => {
    if (Date.now() - focusedAt < focusIntervalMs) return;
    focusedAt = Date.now();
    refresh();
  };

  const storageChanged = (event: StorageEvent) => {
    if (event.key === PUSH_REGISTRATION_KEY || event.key === null) refresh();
  };

  const subscriptionChanged = (event: MessageEvent<unknown>) => {
    if (event.data === "staydesk:push-subscription-changed") refresh();
  };

  window.addEventListener("focus", focused);
  window.addEventListener("online", refresh);
  window.addEventListener("storage", storageChanged);
  window.addEventListener(DEVICE_PUSH_CHANGED, refresh);
  navigator.serviceWorker?.addEventListener("message", subscriptionChanged);

  return () => {
    window.removeEventListener("focus", focused);
    window.removeEventListener("online", refresh);
    window.removeEventListener("storage", storageChanged);
    window.removeEventListener(DEVICE_PUSH_CHANGED, refresh);
    navigator.serviceWorker?.removeEventListener(
      "message",
      subscriptionChanged,
    );
  };
}

export function pushSubscriptionInput(
  subscription: PushSubscription,
): PushSubscriptionInput {
  const { keys } = subscription.toJSON();

  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: keys?.p256dh ?? "", auth: keys?.auth ?? "" },
  };
}

export async function storeWorkerPushRegistration(
  userId: string,
  subscription: PushSubscription,
  mode: "replace" | "if-missing" = "replace",
): Promise<void> {
  const input = pushSubscriptionInput(subscription);
  // Without its secret the worker could neither renew nor retire it.
  if (input.keys.auth === "") return;

  const cache = await caches.open(PUSH_DEVICE_CACHE);
  if (mode === "if-missing" && (await cache.match(PUSH_DEVICE_URL))) return;

  await cache.put(
    PUSH_DEVICE_URL,
    new Response(JSON.stringify({ userId, subscription: input })),
  );
}

export function requestPushMaintenance(
  registration: ServiceWorkerRegistration | undefined,
): void {
  registration?.active?.postMessage("staydesk:maintain-device-push");
}

export function rememberedPushRegistration(): {
  userId: string;
  endpoint: string;
} | null {
  try {
    const stored = localStorage.getItem(PUSH_REGISTRATION_KEY);
    if (stored === null) return null;

    const value: unknown = JSON.parse(stored);
    if (
      typeof value === "object" &&
      value !== null &&
      "userId" in value &&
      typeof value.userId === "string" &&
      "endpoint" in value &&
      typeof value.endpoint === "string"
    ) {
      return { userId: value.userId, endpoint: value.endpoint };
    }
  } catch {
    // Storage may be disabled. The browser can still subscribe explicitly.
  }

  return null;
}

export function rememberPushEndpoint(userId: string, endpoint: string): void {
  const saved = rememberedPushRegistration();
  if (saved?.userId === userId && saved.endpoint === endpoint) return;

  try {
    localStorage.setItem(
      PUSH_REGISTRATION_KEY,
      JSON.stringify({ userId, endpoint }),
    );
  } catch {
    // A later reconciliation can recover ownership from the API.
    return;
  }

  window.dispatchEvent(new Event(DEVICE_PUSH_CHANGED));
}

function forgetPushEndpoint(): void {
  try {
    localStorage.removeItem(PUSH_REGISTRATION_KEY);
  } catch {
    // Storage may be disabled.
  }
}

export async function allowDevicePush(): Promise<void> {
  await globalThis.caches?.delete(PUSH_DISABLED_CACHE);
}

export async function devicePushIsDisabled(): Promise<boolean> {
  return (await globalThis.caches?.has(PUSH_DISABLED_CACHE)) ?? false;
}

export async function pendingPushRemovals(userId: string): Promise<string[]> {
  if (!(await caches.has(PUSH_REMOVALS_CACHE))) return [];

  const cache = await caches.open(PUSH_REMOVALS_CACHE);
  const saved: unknown = await (await cache.match(removalsUrl(userId)))?.json();

  return Array.isArray(saved)
    ? saved.filter(
        (endpoint): endpoint is string => typeof endpoint === "string",
      )
    : [];
}

/** Update under the device lock so re-enabling cannot race a pending DELETE. */
export async function updatePushRemovals(
  userId: string,
  endpoints: Iterable<string>,
  operation: "add" | "remove",
): Promise<void> {
  const saved = await pendingPushRemovals(userId);
  const pending = new Set(saved);
  for (const endpoint of endpoints) {
    if (operation === "add") pending.add(endpoint);
    else pending.delete(endpoint);
  }
  if (pending.size === saved.length) return;

  const cache = await caches.open(PUSH_REMOVALS_CACHE);
  const url = removalsUrl(userId);
  if (pending.size === 0) await cache.delete(url);
  else await cache.put(url, new Response(JSON.stringify([...pending])));

  window.dispatchEvent(new Event(DEVICE_PUSH_CHANGED));
}

function removalsUrl(userId: string): string {
  return new URL(
    `/push-removals/${encodeURIComponent(userId)}`,
    location.origin,
  ).href;
}

/** Call under the device lock so an enable or a push cannot overtake the cleanup. */
export async function clearDevicePush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  // Persist the opt-out before talking to the browser's push provider, which can be offline.
  const marker = await globalThis.caches
    ?.open(PUSH_DISABLED_CACHE)
    .catch(() => undefined);
  const registration = await navigator.serviceWorker
    .getRegistration()
    .catch((error: unknown) => {
      if (marker) return undefined;
      throw error;
    });
  const shown = (await registration?.getNotifications().catch(() => [])) ?? [];
  for (const notification of shown) notification.close();

  const subscription = await registration?.pushManager
    ?.getSubscription()
    .catch((error: unknown) => {
      if (marker) return null;
      throw error;
    });
  const saved = rememberedPushRegistration();
  if (subscription && saved?.endpoint === subscription.endpoint) {
    await storeWorkerPushRegistration(
      saved.userId,
      subscription,
      "if-missing",
    ).catch(() => undefined);
  }
  requestPushMaintenance(registration);
  if (subscription) {
    const removed = await subscription.unsubscribe().catch(() => false);
    if (
      !removed &&
      !marker &&
      (await registration?.pushManager.getSubscription())
    ) {
      throw new Error("The browser did not remove its push subscription");
    }
  }

  const hadRegistration = rememberedPushRegistration() !== null;
  forgetPushEndpoint();
  if (hadRegistration || subscription)
    window.dispatchEvent(new Event(DEVICE_PUSH_CHANGED));
}
