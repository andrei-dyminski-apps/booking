import {
  clearDevicePush,
  devicePushIsDisabled,
  pendingPushRemovals,
  pushSubscriptionInput,
  rememberedPushRegistration,
  rememberPushEndpoint,
  storeWorkerPushRegistration,
  supportsPush,
  updatePushRemovals,
  withDevicePushLock,
} from "../lib";
import { authApi } from "./auth";
import { ApiResponseError } from "./http-client";
import { pushApi } from "./push";

/** A tab can still be displaying the previous account after another tab signs in. */
export async function isDevicePushAccount(
  userId: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const user = await authApi.me({ cache: "no-store" }, signal);

  return user.id === userId;
}

export async function reconcileDevicePush(
  userId: string,
  signal: AbortSignal,
): Promise<void> {
  if (!supportsPush()) return;

  await withDevicePushLock(async () => {
    if (signal.aborted) return;
    await flushPushRemovals(userId, signal);
    if (signal.aborted || (await devicePushIsDisabled())) return;

    const saved = rememberedPushRegistration();
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();

    if (!saved && !subscription) return;
    if (signal.aborted || !(await isDevicePushAccount(userId, signal))) return;
    if (signal.aborted) return;

    if (saved && saved.userId !== userId) {
      await clearDevicePush();

      return;
    }

    if (!subscription || Notification.permission !== "granted") return;

    const { registered } = await pushApi.subscriptionStatus(
      userId,
      subscription.endpoint,
      signal,
    );
    if (signal.aborted) return;

    if (!registered) {
      if (!saved) {
        await clearDevicePush();

        return;
      }

      await replacePushEndpoint(userId, subscription, saved.endpoint, signal);
    }

    // An endpoint can retain its URL when the browser rotates its keys. Keep
    // the worker's existing proof until the API confirms the new keys.
    await storeWorkerPushRegistration(
      userId,
      subscription,
      registered ? "if-missing" : "replace",
    );
    rememberPushEndpoint(userId, subscription.endpoint);
  });
}

/** Retry only with the account that owned the subscription, under the device lock. */
export async function flushPushRemovals(
  userId: string,
  signal?: AbortSignal,
): Promise<void> {
  const endpoints = await pendingPushRemovals(userId);
  if (signal?.aborted || !navigator.onLine || endpoints.length === 0) return;

  const results = await Promise.allSettled(
    endpoints.map((endpoint) => pushApi.unsubscribe(userId, endpoint, signal)),
  );
  await updatePushRemovals(
    userId,
    endpoints.filter((_, index) => results[index]?.status === "fulfilled"),
    "remove",
  );
}

async function replacePushEndpoint(
  userId: string,
  subscription: PushSubscription,
  previousEndpoint: string,
  signal: AbortSignal,
): Promise<void> {
  const input = pushSubscriptionInput(subscription);

  try {
    await pushApi.subscribe(userId, { ...input, previousEndpoint }, signal);
  } catch (error) {
    if (
      !(error instanceof ApiResponseError) ||
      error.code !== "PUSH_SUBSCRIPTION_REUSE" ||
      (await pushApi.subscriptionStatus(userId, previousEndpoint, signal))
        .registered
    ) {
      throw error;
    }

    // The provider can invalidate the previous endpoint before the browser reconnects.
    // The normal registration still rejects any endpoint held by another account.
    await pushApi.subscribe(userId, input, signal);
  }
}
