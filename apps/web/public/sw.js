// The service worker of the site: an offline page in place of the browser's error, and the
// push notifications the API sends while no tab is open, with a receipt for each. It caches
// nothing else — every page is personal or live, so a copy served from here would be
// somebody's stale screen.
// Plain JavaScript in public/: a worker is fetched by its URL and never bundled.

// A new value replaces the cached offline page on the next visit.
const OFFLINE_CACHE_PREFIX = "staydesk-offline-";
const OFFLINE_CACHE = OFFLINE_CACHE_PREFIX + "v1";
const OFFLINE_URL = "/offline.html";
// Shared with shared/lib/pwa/device-push.ts.
const DEVICE_PUSH_LOCK = "staydesk:device-push";
const PUSH_DISABLED_CACHE = "staydesk-push-disabled";
const PUSH_DEVICE_CACHE = "staydesk-push-device-v1";
const PUSH_DEVICE_URL = "/push-device-registration";
const PUSH_SYNC_TAG = "staydesk-device-push";
const ACCOUNT_CHANGE_PATHS = new Set([
  "/login",
  "/complete-registration",
  "/api/auth/login",
  "/api/auth/register/complete",
]);
let deviceOperation = Promise.resolve();

function withDeviceLock(operation) {
  if (self.navigator.locks)
    return self.navigator.locks.request(DEVICE_PUSH_LOCK, operation);

  const result = deviceOperation.then(operation);
  deviceOperation = result.catch(() => undefined);
  return result;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith(OFFLINE_CACHE_PREFIX) && name !== OFFLINE_CACHE,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.registration.navigationPreload?.enable())
      .then(() => self.clients.claim()),
  );
});

// Only page loads get an offline response. Sign-in goes through the network under the
// same lock as notification display.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.method === "POST" &&
    url.origin === self.location.origin &&
    ACCOUNT_CHANGE_PATHS.has(url.pathname)
  ) {
    // The new cookies are in place once the response arrives, and the page gets it at once.
    // The lock is held past that until the device is checked against the new account, so
    // a push that lands in between waits rather than showing the previous account's text.
    let respond;
    let fail;
    const response = new Promise((resolve, reject) => {
      respond = resolve;
      fail = reject;
    });
    const maintained = withDeviceLock(async () => {
      try {
        respond(await fetch(request));
      } catch (error) {
        fail(error);
        return;
      }
      await maintainDevice().catch(scheduleMaintenance);
    });

    event.respondWith(response);
    // A lock that could not be taken never fetched: the page gets the failure. Past the
    // response, `fail` does nothing.
    event.waitUntil(maintained.catch(fail));
    return;
  }

  if (request.mode !== "navigate" || request.method !== "GET") return;

  // The preload was started alongside the worker's boot, so a page load does not wait for it.
  event.respondWith(
    (async () => {
      try {
        return (await event.preloadResponse) ?? (await fetch(request));
      } catch {
        const cache = await caches.open(OFFLINE_CACHE);
        const offline = await cache.match(OFFLINE_URL);

        return offline ?? Response.error();
      }
    })(),
  );
});

/** The absolute same-origin destination, falling back to the home page. */
function siteUrl(value) {
  const home = new URL("/", self.location.origin);
  if (typeof value !== "string") return home.href;

  try {
    const url = new URL(value, home);

    if (url.origin === home.origin && url.protocol === home.protocol) {
      return url.href;
    }
  } catch {
    // Invalid URLs lead home.
  }

  return home.href;
}

// What the API is told about a push: that it reached this browser, and that it was
// clicked. Public on the API's side — the session may have ended since the browser
// subscribed — so the delivery's id is all it carries. A receipt that fails is lost: the
// push is shown either way.
function sendReceipt(receipt, event) {
  if (typeof receipt !== "string") return Promise.resolve();

  return fetch("/api/push/receipts", {
    method: "POST",
    credentials: "omit",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: receipt, event }),
  }).catch(() => undefined);
}

function readPush(data) {
  try {
    const push = data.json();

    return {
      title: typeof push.title === "string" ? push.title : "StayDesk",
      body: typeof push.body === "string" ? push.body : "",
      url: siteUrl(push.url),
      tag: typeof push.tag === "string" ? push.tag : undefined,
      messageAt: Number.isSafeInteger(push.messageAt) ? push.messageAt : null,
      receipt: typeof push.receipt === "string" ? push.receipt : null,
      subscriptionFingerprint:
        typeof push.subscriptionFingerprint === "string"
          ? push.subscriptionFingerprint
          : null,
    };
  } catch {
    return null;
  }
}

const pendingNotifications = new Map();

async function showPush(push) {
  let notification = {
    title: push.title,
    body: push.body,
    data: { url: push.url, receipt: push.receipt, messageAt: push.messageAt },
    silent: undefined,
  };
  if (push.tag?.startsWith("conversation-")) {
    const visible = await self.registration
      .getNotifications({ tag: push.tag })
      .catch(() => []);
    const newer = visible.find(
      ({ data }) =>
        Number.isSafeInteger(data?.messageAt) &&
        (push.messageAt === null || data.messageAt >= push.messageAt),
    );

    // Web Push requires a visible notification for every delivery. Keep the newer
    // message visible in the same slot without alerting the reader again.
    if (newer) {
      notification = {
        title: newer.title,
        body: newer.body,
        data: newer.data,
        silent: true,
      };
    }
  }

  await self.registration.showNotification(notification.title, {
    body: notification.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: push.tag,
    data: notification.data,
    silent: notification.silent,
    // A notification that replaces one with its tag alerts again only when asked to,
    // so a second message of a thread would otherwise arrive without a sound.
    renotify: push.tag !== undefined && notification.silent !== true,
  });
}

function showInOrder(push) {
  if (!push.tag?.startsWith("conversation-")) return showPush(push);

  // Two concurrent push events for this thread must check and replace in sequence.
  const tag = push.tag;
  const previous = pendingNotifications.get(tag) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => showPush(push));
  pendingNotifications.set(tag, current);

  return current.finally(() => {
    if (pendingNotifications.get(tag) === current)
      pendingNotifications.delete(tag);
  });
}

async function matchesCurrentSubscription(fingerprint) {
  if (fingerprint === null) return false;

  const subscription = await self.registration.pushManager.getSubscription();
  const key = subscription?.getKey("auth");
  if (!key) return false;

  // The Web Push gateway hashes the same bytes before encrypting the payload.
  const digest = await self.crypto.subtle.digest("SHA-256", key);
  const current = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return current === fingerprint;
}

async function readDeviceAccount() {
  const response = await fetch("/api/push/device-owner", {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Could not verify the push account");

  return await response.json();
}

async function updateSubscription(userId, subscription, replacement) {
  const response = await fetch("/api/push/subscriptions/maintenance", {
    method: "POST",
    credentials: "omit",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(5000),
    body: JSON.stringify({
      accountId: userId,
      endpoint: subscription.endpoint,
      auth: subscription.keys.auth,
      replacement,
    }),
  });

  if (response.status === 429 || response.status >= 500)
    throw new Error("Push maintenance is temporarily unavailable");

  // Any other refusal is final: the same request would be refused again.
  return response.status === 204 ? "done" : "refused";
}

/** Tells every open page to reconcile its subscription with the API. */
async function announceSubscriptionChange() {
  const windows = await self.clients.matchAll({ type: "window" });
  for (const window of windows) {
    window.postMessage("staydesk:push-subscription-changed");
  }
}

function scheduleMaintenance() {
  return self.registration.sync?.register(PUSH_SYNC_TAG).catch(() => undefined);
}

async function retireDevice(cache, device) {
  await caches.open(PUSH_DISABLED_CACHE);
  const shown = await self.registration.getNotifications().catch(() => []);
  for (const notification of shown) notification.close();

  // Without its secret a subscription cannot be revoked from here; the page's pending
  // removal covers it with the session instead.
  const subscriptions = [device.subscription, device.replacement].filter(
    (subscription) => subscription?.keys?.auth,
  );
  const revoked = await Promise.all(
    subscriptions.map((subscription) =>
      updateSubscription(device.userId, subscription).then(
        () => true,
        () => false,
      ),
    ),
  );
  const current = await self.registration.pushManager.getSubscription();
  const unsubscribed =
    !current || (await current.unsubscribe().catch(() => false));
  if (!revoked.every(Boolean) || !unsubscribed)
    throw new Error("Push retirement is pending");

  await cache.delete(PUSH_DEVICE_URL);
}

async function maintainDevice() {
  const cache = await caches.open(PUSH_DEVICE_CACHE);
  let device = await (await cache.match(PUSH_DEVICE_URL))?.json();
  if (!device) return false;

  if (await caches.has(PUSH_DISABLED_CACHE)) {
    await retireDevice(cache, device);
    return false;
  }

  // Only another account retires the subscription. No owner at all is a session that
  // ended without a sign-out here — a refresh refused after a block or a token reuse, a
  // cleared cookie — so pushes lose their text and keep coming: the same account signing
  // in again brings it back, and another one retires the subscription then. Whatever must
  // stop for good on a revoked session, the API stops on its side (a reset deletes the
  // account's subscriptions, a block pushes nothing).
  const owner = await readDeviceAccount();
  if (owner !== null && owner !== device.userId) {
    await retireDevice(cache, device);
    return false;
  }
  const verified = owner === device.userId;

  const current = await self.registration.pushManager.getSubscription();
  if (!current) return false;

  // A retry first confirms the intermediate endpoint before using it as proof for
  // another rotation.
  if (device.replacement) {
    if (!(await commitReplacement(cache, device, device.replacement)))
      return false;
    device = { userId: device.userId, subscription: device.replacement };
  }

  const replacement = {
    endpoint: current.endpoint,
    keys: current.toJSON().keys,
  };
  if (
    replacement.endpoint === device.subscription.endpoint &&
    replacement.keys?.auth === device.subscription.keys.auth &&
    replacement.keys?.p256dh === device.subscription.keys.p256dh
  ) {
    return verified;
  }

  // A lost reply may leave either endpoint registered. Keep both credentials for
  // retirement and for a retry with the same old and new subscriptions.
  await cache.put(
    PUSH_DEVICE_URL,
    new Response(JSON.stringify({ ...device, replacement })),
  );
  // Renewal needs no owner: it proves itself with the old secret, and keeps the
  // subscription alive for the account's return.
  return (await commitReplacement(cache, device, replacement)) && verified;
}

async function commitReplacement(cache, device, replacement) {
  const result = await updateSubscription(
    device.userId,
    device.subscription,
    replacement,
  );
  if (result === "refused") {
    // The old proof is spent (PUSH_SUBSCRIPTION_REUSE): retrying it would be refused on
    // every push. Only a page with the session can register this browser again.
    await cache.delete(PUSH_DEVICE_URL);
    await announceSubscriptionChange();
    return false;
  }
  await cache.put(
    PUSH_DEVICE_URL,
    new Response(
      JSON.stringify({ userId: device.userId, subscription: replacement }),
    ),
  );
  return true;
}

async function displayPush(push) {
  const verified = await maintainDevice().catch(async () => {
    await scheduleMaintenance();
    return false;
  });
  if (
    push &&
    verified &&
    (await matchesCurrentSubscription(push.subscriptionFingerprint).catch(
      () => false,
    ))
  ) {
    await showInOrder(push);
    return;
  }

  // The provider may already have accepted this delivery before the opt-out.
  // Browsers require a visible notification for a delivered Web Push.
  await self.registration.showNotification("StayDesk", {
    body: "Open StayDesk to check your notifications.",
    icon: "/icon-192.png",
    tag: "staydesk-push-status",
    silent: true,
  });
}

self.addEventListener("push", (event) => {
  const push = event.data ? readPush(event.data) : null;

  const notification = withDeviceLock(() => displayPush(push));

  event.waitUntil(
    Promise.all([sendReceipt(push?.receipt, "received"), notification]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = siteUrl(event.notification.data?.url);

  event.waitUntil(sendReceipt(event.notification.data?.receipt, "clicked"));

  // A Client reports the document's initial URL even after an App Router navigation.
  // Open the destination without navigating an existing tab away from its work.
  event.waitUntil(self.clients.openWindow(url));
});

async function applicationServerKey(oldSubscription) {
  const key = oldSubscription?.options?.applicationServerKey;
  if (key) return key;

  const response = await fetch("/api/push/config", {
    credentials: "omit",
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Could not read the push key");
  const { publicKey } = await response.json();
  if (typeof publicKey !== "string") throw new Error("Push is off");

  const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(
    atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
    (char) => char.charCodeAt(0),
  );
}

// The Push API lets a browser expire a subscription without creating its successor.
// With no tab open, nobody else would subscribe again before the next visit.
async function resubscribe(oldSubscription) {
  const cache = await caches.open(PUSH_DEVICE_CACHE);
  if (
    !(await cache.match(PUSH_DEVICE_URL)) ||
    (await caches.has(PUSH_DISABLED_CACHE)) ||
    self.Notification?.permission !== "granted" ||
    (await self.registration.pushManager.getSubscription())
  ) {
    return;
  }

  await self.registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: await applicationServerKey(oldSubscription),
  });
}

// Renew in the background and let any open page refresh its subscription status.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    withDeviceLock(async () => {
      await resubscribe(event.oldSubscription).catch(() => undefined);
      return await maintainDevice();
    })
      .catch(scheduleMaintenance)
      .then(announceSubscriptionChange),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "staydesk:maintain-device-push") {
    event.waitUntil(
      withDeviceLock(() => maintainDevice()).catch(scheduleMaintenance),
    );
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === PUSH_SYNC_TAG)
    event.waitUntil(withDeviceLock(() => maintainDevice()));
});
