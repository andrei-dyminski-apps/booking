import {
  pushConfigSchema,
  pushSubscriptionStatusSchema,
  storedPushPreferencesSchema,
  type PushPreferencesPatch,
  type PushRegistration,
} from "@repo/contracts";
import { z } from "zod";
import { apiRequest } from "./http-client";

function accountPath(path: string, userId: string): string {
  return `${path}?accountId=${encodeURIComponent(userId)}`;
}

/** The browser's push subscription on the API's side — see `PushController`. */
export const pushApi = {
  config: () =>
    apiRequest({
      method: "GET",
      path: "/push/config",
      schema: pushConfigSchema,
      read: { cache: "no-store" },
    }),
  subscribe: (
    userId: string,
    subscription: PushRegistration,
    signal?: AbortSignal,
  ) =>
    apiRequest({
      method: "POST",
      path: accountPath("/push/subscriptions", userId),
      body: subscription,
      schema: z.void(),
      signal,
    }),
  subscriptionStatus: (
    userId: string,
    endpoint: string,
    signal?: AbortSignal,
  ) =>
    apiRequest({
      method: "POST",
      path: accountPath("/push/subscriptions/status", userId),
      body: { endpoint },
      schema: pushSubscriptionStatusSchema,
      signal,
    }),
  settings: (userId: string, signal?: AbortSignal) =>
    apiRequest({
      method: "GET",
      path: accountPath("/push/settings", userId),
      schema: storedPushPreferencesSchema,
      read: { cache: "no-store" },
      signal,
    }),
  savePreferences: (userId: string, preferences: PushPreferencesPatch) =>
    apiRequest({
      method: "PATCH",
      path: accountPath("/push/settings", userId),
      body: preferences,
      schema: z.void(),
    }),
  unsubscribe: (userId: string, endpoint: string, signal?: AbortSignal) =>
    apiRequest({
      method: "DELETE",
      path: accountPath("/push/subscriptions", userId),
      body: { endpoint },
      schema: z.void(),
      signal,
    }),
};
