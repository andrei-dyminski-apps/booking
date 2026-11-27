"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@repo/ui/components/button";
import { flushPushRemovals } from "#shared/api";
import {
  canPromptInstall,
  DEVICE_PUSH_FOCUS_INTERVAL_MS,
  pendingPushRemovals,
  promptInstall,
  subscribeInstallPrompt,
  watchDevicePush,
  withDevicePushLock,
} from "#shared/lib";
import {
  pushErrorMessage,
  readDevice,
  turnOffDevicePush,
  turnOnDevicePush,
  type Device,
} from "../model/device-push";

/**
 * The browser this page is open in, as opposed to the account: installing the site as an
 * app, and the push notifications the API sends here while no tab is open. Both are a
 * property of the device — a phone can have them on and the laptop off — so each answer is
 * read from the browser after it mounts, and the server render draws only the heading.
 *
 * A null key means push is disabled at the API. An undefined key means the request
 * failed, so an existing subscription can still be turned off while the key is retried.
 */
export const DeviceSettings = ({
  userId,
  pushKey,
}: {
  userId: string;
  pushKey: string | null | undefined;
}) => {
  const router = useRouter();
  const [retryingConfig, retryConfig] = useTransition();
  const [device, setDevice] = useState<Device | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [check, setCheck] = useState(0);
  const installable = useSyncExternalStore(
    subscribeInstallPrompt,
    canPromptInstall,
    () => false,
  );

  useEffect(() => {
    if (pending) return;

    let request: AbortController | undefined;

    const refresh = () => {
      request?.abort();
      const current = new AbortController();
      request = current;

      const show = (next: Device) => {
        if (current.signal.aborted) return;
        setDevice((displayed) =>
          next.push === "checking" &&
          displayed &&
          displayed.push !== "unavailable"
            ? { ...next, push: displayed.push }
            : next,
        );
      };

      void readDevice(userId, pushKey, current.signal, show).then(show);
    };

    const stop = watchDevicePush(refresh, {
      focusIntervalMs: DEVICE_PUSH_FOCUS_INTERVAL_MS,
    });
    refresh();

    return () => {
      request?.abort();
      stop();
    };
  }, [check, pending, pushKey, userId]);

  async function install() {
    const accepted = await promptInstall().catch(() => false);

    setStatus(accepted ? "StayDesk is being installed." : "");
  }

  async function turnPushOn() {
    if (typeof pushKey !== "string") return;

    setPending(true);
    setStatus("");

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setDevice(
          (current) =>
            current && {
              ...current,
              push: permission === "denied" ? "denied" : "off",
            },
        );

        return;
      }

      await turnOnDevicePush(userId, pushKey);
      setDevice(
        (current) => current && { ...current, canTurnOff: true, push: "on" },
      );
      setStatus("Notifications are on for this device.");
    } catch (error) {
      setStatus(pushErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  async function turnPushOff() {
    setPending(true);
    setStatus("");

    try {
      await turnOffDevicePush(userId);

      setDevice(
        (current) => current && { ...current, canTurnOff: false, push: "off" },
      );
      setStatus("Notifications are off for this device.");
      void withDevicePushLock(() => flushPushRemovals(userId)).catch(
        () => undefined,
      );
    } catch (error) {
      setStatus(pushErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  function retryPushRemoval() {
    if (!navigator.onLine) {
      setStatus(
        "You are offline. The removal will be retried when you reconnect.",
      );

      return;
    }

    setPending(true);
    setStatus("");
    // A refused removal stays queued rather than throwing, so what is left says whether
    // the retry went through.
    void withDevicePushLock(async () => {
      await flushPushRemovals(userId);

      return (await pendingPushRemovals(userId)).length;
    })
      .then((left) => {
        if (left > 0) {
          setStatus(
            "Could not remove the subscription from your account. Please try again.",
          );
        }
      })
      .catch((error: unknown) => setStatus(pushErrorMessage(error)))
      .finally(() => setPending(false));
  }

  return (
    <section
      aria-labelledby="device-heading"
      className="flex flex-col gap-3 border-t pt-6"
    >
      <h2 id="device-heading" className="text-sm font-medium">
        This device
      </h2>

      {pushKey === undefined && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            Could not load notification availability.
          </p>
          <Button
            variant="outline"
            loading={retryingConfig}
            onClick={() => retryConfig(() => router.refresh())}
          >
            Retry notification configuration
          </Button>
        </div>
      )}

      {device !== null && (
        <>
          {device.standalone ? (
            <p className="text-sm text-muted-foreground">
              StayDesk is installed on this device.
            </p>
          ) : installable ? (
            <Button variant="outline" onClick={() => void install()}>
              Install app
            </Button>
          ) : device.appleMobile ? (
            <p className="text-sm text-muted-foreground">
              To install StayDesk, tap Share in Safari, then Add to Home Screen.
            </p>
          ) : null}

          {(typeof pushKey === "string" ||
            ((device.canTurnOff || pushKey === undefined) &&
              device.push === "unavailable")) && (
            <PushControl
              device={device}
              pending={pending}
              canTurnOn={typeof pushKey === "string"}
              onTurnOn={() => void turnPushOn()}
              onRetry={() => setCheck((value) => value + 1)}
            />
          )}
          {/* With a fresh subscription on offer, turning on replaces whatever is
              left here, so a second button that only removes it would be a choice
              without a difference. */}
          {device.canTurnOff &&
            !(device.push === "off" && typeof pushKey === "string") && (
              <Button
                variant="outline"
                loading={pending}
                onClick={() => void turnPushOff()}
              >
                Turn off notifications on this device
              </Button>
            )}
          {device.removalPending && (
            <div className="grid gap-2">
              <p className="text-sm text-muted-foreground">
                Removing a subscription from your account is pending.
              </p>
              <Button
                variant="outline"
                loading={pending}
                onClick={retryPushRemoval}
              >
                Retry removing subscription
              </Button>
            </div>
          )}
        </>
      )}

      <p role="status" className="text-sm">
        {status}
      </p>
    </section>
  );
};

const PushControl = ({
  device,
  pending,
  canTurnOn,
  onTurnOn,
  onRetry,
}: {
  device: Device;
  pending: boolean;
  canTurnOn: boolean;
  onTurnOn: () => void;
  onRetry: () => void;
}) => {
  switch (device.push) {
    case "unsupported":
      return (
        <p className="text-sm text-muted-foreground">
          {device.appleMobile && !device.standalone
            ? "Add StayDesk to your Home Screen to get notifications on this device."
            : "This browser cannot show notifications from StayDesk."}
        </p>
      );
    case "denied":
      return (
        <p className="text-sm text-muted-foreground">
          Notifications from StayDesk are blocked in this browser&rsquo;s
          settings.
        </p>
      );
    case "unavailable":
      return (
        <>
          <p className="text-sm text-muted-foreground">
            Could not check notifications on this device.
          </p>
          <Button variant="outline" onClick={onRetry}>
            Check again
          </Button>
        </>
      );
    case "on":
      return (
        <p className="text-sm text-muted-foreground">
          This device gets notifications from StayDesk, even with it closed.
        </p>
      );
    case "checking":
      return null;
    case "off":
      return canTurnOn ? (
        <>
          <p className="text-sm text-muted-foreground">
            Get bookings, payments and messages as notifications here, even with
            StayDesk closed.
          </p>
          <Button variant="outline" loading={pending} onClick={onTurnOn}>
            Turn on notifications on this device
          </Button>
        </>
      ) : null;
  }
};
