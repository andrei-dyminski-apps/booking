import {
  ApiResponseError,
  ApiUnreachableError,
  isDevicePushAccount,
  pushApi,
} from "#shared/api";
import {
  allowDevicePush,
  base64UrlToBytes,
  clearDevicePush,
  devicePushIsDisabled,
  isAppleMobile,
  isStandalone,
  pendingPushRemovals,
  pushSubscriptionInput,
  registerServiceWorker,
  rememberPushEndpoint,
  rememberedPushRegistration,
  requestPushMaintenance,
  storeWorkerPushRegistration,
  supportsPush,
  toFormErrors,
  updatePushRemovals,
  withDevicePushLock,
} from "#shared/lib";

/** What the browser this page runs in can do, read once it has mounted. */
export type Device = {
  standalone: boolean;
  appleMobile: boolean;
  push: "unsupported" | "denied" | "off" | "on" | "checking" | "unavailable";
  canTurnOff: boolean;
  removalPending: boolean;
};

/**
 * Reads the device in two steps: what the browser alone says is handed to
 * `showLocalDevice` as `checking` before the API is asked whether it knows the
 * subscription, so a slow API does not hold up the rest of the section.
 */
export async function readDevice(
  userId: string,
  pushKey: string | null | undefined,
  signal: AbortSignal,
  showLocalDevice: (device: Device) => void,
): Promise<Device> {
  const device = {
    standalone: isStandalone(),
    appleMobile: isAppleMobile(navigator.userAgent, navigator.maxTouchPoints),
    canTurnOff: false,
    removalPending: false,
  };
  if (!supportsPush()) return { ...device, push: "unsupported" };

  const saved = rememberedPushRegistration();
  device.canTurnOff = saved?.userId === userId;
  device.removalPending =
    (await pendingPushRemovals(userId).catch(() => [])).length > 0;
  try {
    if (await devicePushIsDisabled()) {
      return { ...device, canTurnOff: false, push: "off" };
    }

    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription && (saved === null || saved.userId === userId)) {
      device.canTurnOff = true;
    }
    if (Notification.permission === "denied")
      return { ...device, push: "denied" };
    if (Notification.permission !== "granted")
      return { ...device, push: "off" };

    if (!subscription || (pushKey && !usesPushKey(subscription, pushKey))) {
      return { ...device, push: "off" };
    }

    showLocalDevice({ ...device, push: "checking" });
    const { registered } = await pushApi.subscriptionStatus(
      userId,
      subscription.endpoint,
      signal,
    );

    return { ...device, push: registered ? "on" : "off" };
  } catch {
    return { ...device, push: "unavailable" };
  }
}

function usesPushKey(
  subscription: PushSubscription,
  publicKey: string,
): boolean {
  const key = subscription.options.applicationServerKey;
  const expected = base64UrlToBytes(publicKey);

  return (
    key !== null &&
    key.byteLength === expected.length &&
    new Uint8Array(key).every((byte, index) => byte === expected[index])
  );
}

class DevicePushError extends Error {}

const ACCOUNT_CHANGED =
  "Your account has changed. Reload the page and try again.";

/** How long a worker registered just now may take to install and activate. */
const WORKER_ACTIVATION_TIMEOUT_MS = 10_000;

/**
 * The worker that will receive the pushes, once it is active. A registration made a
 * moment ago is still installing — the shell registers on mount, and a quick press can
 * beat it — so this waits for `ready` rather than reading `active` as it stands. `ready`
 * never settles when the install fails, hence the timeout.
 */
async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  if (!(await navigator.serviceWorker.getRegistration())) {
    await registerServiceWorker();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), WORKER_ACTIVATION_TIMEOUT_MS);
  });

  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      timedOut,
    ]);
    if (registration?.active) return registration;
  } finally {
    clearTimeout(timer);
  }

  throw new DevicePushError(
    "The app could not start notifications. Please try again.",
  );
}

export function pushErrorMessage(error: unknown): string {
  if (error instanceof DevicePushError) return error.message;
  if (
    error instanceof ApiResponseError ||
    error instanceof ApiUnreachableError
  ) {
    return toFormErrors(error).message ?? "Please try again.";
  }

  return "The browser could not change notifications. Please try again.";
}

/**
 * Subscribes this browser for the account, under the device lock. An existing subscription
 * with the same key that the API still knows is kept; anything else is cleared first and
 * queued for removal at the API, so an endpoint the account no longer uses never lingers.
 */
export async function turnOnDevicePush(
  userId: string,
  pushKey: string,
): Promise<void> {
  await withDevicePushLock(async () => {
    if (!(await isDevicePushAccount(userId))) {
      throw new DevicePushError(ACCOUNT_CHANGED);
    }

    const registration = await activeRegistration();

    const previous = await registration.pushManager.getSubscription();
    const saved = rememberedPushRegistration();
    if (
      previous &&
      usesPushKey(previous, pushKey) &&
      !(await devicePushIsDisabled()) &&
      (await pushApi.subscriptionStatus(userId, previous.endpoint)).registered
    ) {
      await storeWorkerPushRegistration(userId, previous, "if-missing");
      requestPushMaintenance(registration);
      rememberPushEndpoint(userId, previous.endpoint);

      return;
    }

    if (saved?.userId === userId) {
      await updatePushRemovals(userId, [saved.endpoint], "add");
    }
    if (previous) {
      await clearDevicePush();
      if (await registration.pushManager.getSubscription()) {
        throw new DevicePushError(
          "The previous browser subscription could not be removed. Please try again.",
        );
      }
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(pushKey),
    });
    try {
      await pushApi.subscribe(userId, pushSubscriptionInput(subscription));
      await updatePushRemovals(userId, [subscription.endpoint], "remove");
      await storeWorkerPushRegistration(userId, subscription);
      await allowDevicePush();
    } catch (error) {
      await pushApi
        .unsubscribe(userId, subscription.endpoint)
        .catch(() => undefined);
      await subscription.unsubscribe().catch(() => undefined);
      throw error;
    }

    rememberPushEndpoint(userId, subscription.endpoint);
  });
}

/**
 * Clears this browser's subscription, under the device lock. Its endpoints are queued for
 * removal at the API before the browser is asked, so an offline API or push provider
 * leaves a removal to retry rather than a subscription the account still pushes to.
 */
export async function turnOffDevicePush(userId: string): Promise<void> {
  await withDevicePushLock(async () => {
    const saved = rememberedPushRegistration();
    if (saved && saved.userId !== userId) {
      throw new DevicePushError(ACCOUNT_CHANGED);
    }

    const registration = await navigator.serviceWorker
      .getRegistration()
      .catch(() => undefined);
    const subscription = await registration?.pushManager
      .getSubscription()
      .catch(() => null);
    const endpoints = new Set<string>();
    if (subscription) endpoints.add(subscription.endpoint);
    if (saved) endpoints.add(saved.endpoint);

    try {
      await updatePushRemovals(userId, endpoints, "add");
    } finally {
      await clearDevicePush();
    }
  });
}
