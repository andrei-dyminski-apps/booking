"use client";

import { useEffect } from "react";
import {
  captureInstallPrompt,
  DEVICE_PUSH_FOCUS_INTERVAL_MS,
  registerServiceWorker,
  requestPushMaintenance,
  supportsPush,
  watchDevicePush,
} from "#shared/lib";

/**
 * Registers the site's service worker (`public/sw.js`) — the offline page and the push
 * notifications — and keeps the browser's install offer for the profile page's button.
 * Rendered by the shell on every page: a worker installs on whichever page a visit starts
 * on, and the install offer fires there once. `updateViaCache: "none"` makes the browser
 * ask the server for the worker on every check, the same as the `no-store` it is served
 * with, so a deploy reaches every installed copy on its next visit.
 */
export const ServiceWorker = ({ userId }: { userId: string | null }) => {
  useEffect(() => {
    const release = captureInstallPrompt();

    if ("serviceWorker" in navigator) {
      // A browser that refuses (a private window, a policy) is a site without the extras.
      void registerServiceWorker().catch(() => undefined);
    }

    return release;
  }, []);

  useEffect(() => {
    if (!supportsPush()) return;

    let request: AbortController | undefined;

    const refresh = () => {
      request?.abort();
      const current = new AbortController();
      request = current;

      const reconcile = async () => {
        if (userId !== null) {
          const { reconcileDevicePush } = await import("#shared/api");
          await reconcileDevicePush(userId, current.signal).catch(
            () => undefined,
          );
        }
        if (!current.signal.aborted) {
          requestPushMaintenance(
            await navigator.serviceWorker.getRegistration(),
          );
        }
      };

      void reconcile().catch(() => undefined);
    };

    const stop = watchDevicePush(refresh, {
      focusIntervalMs: DEVICE_PUSH_FOCUS_INTERVAL_MS,
    });
    refresh();

    return () => {
      request?.abort();
      stop();
    };
  }, [userId]);

  return null;
};
