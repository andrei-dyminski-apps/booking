"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  loadConnectAndInitialize,
  type AppearanceOptions,
  type StripeConnectInstance,
} from "@stripe/connect-js";
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
  ConnectNotificationBanner,
  ConnectPayouts,
} from "@stripe/react-connect-js";
import { HostAccountStatus } from "@repo/contracts";
import { Skeleton } from "@repo/ui/components/skeleton";
import { payoutsApi } from "#shared/api";
import { stripeVariables } from "#shared/config";

/** The iframe cannot read this site's tokens; the payment form is drawn from the same copy. */
const appearanceFor = (theme: string | undefined): AppearanceOptions => ({
  overlays: "dialog",
  variables: stripeVariables(theme),
});

/**
 * Stripe's embedded components for the caller's payout account. The instance is made in
 * the browser after hydration — it injects a script and reads `window` — and asks for its
 * client secret itself, through the BFF, whenever the session it holds runs out.
 *
 * Until transfers are enabled it shows the onboarding form, and asks the API to check with
 * Stripe (`POST /payouts/account/refresh`) when the screen opens and when the form is left —
 * the account event may not have landed yet. An answer that the account is enabled
 * re-renders the page, whose server half reads it off the row.
 */
export const PayoutsPanel = ({
  enabled,
  publishableKey,
}: {
  enabled: boolean;
  publishableKey: string;
}) => {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [connect, setConnect] = useState<StripeConnectInstance | null>(null);
  // Read by the effect that makes the instance, which must not run again on a theme change:
  // the instance is born in the current theme rather than drawn in the light one first.
  const theme = useRef(resolvedTheme);

  useEffect(() => {
    theme.current = resolvedTheme;
  }, [resolvedTheme]);

  const checkWithStripe = useCallback(async () => {
    try {
      const { status } = await payoutsApi.refresh();

      if (status === HostAccountStatus.ENABLED) router.refresh();
    } catch {
      // The form stays as it is; the account event or the next visit says the rest.
    }
  }, [router]);

  useEffect(() => {
    if (enabled) return;

    // A tick later, for the reason the instance below is: StrictMode's mount, unmount and
    // mount again then ask Stripe once rather than twice.
    const timer = setTimeout(() => {
      void checkWithStripe();
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [enabled, checkWithStripe]);

  useEffect(() => {
    let instance: StripeConnectInstance | null = null;
    // The instance asks for its client secret the moment it is made, so it is made a tick
    // later: StrictMode's mount, unmount and mount again then open one account session.
    const timer = setTimeout(() => {
      instance = loadConnectAndInitialize({
        publishableKey,
        appearance: appearanceFor(theme.current),
        fetchClientSecret: async () =>
          (await payoutsApi.session()).clientSecret,
      });
      setConnect(instance);
    }, 0);

    return () => {
      clearTimeout(timer);
      // An instance left behind would go on renewing a session nobody draws.
      instance?.logout().catch(() => undefined);
      setConnect(null);
    };
  }, [publishableKey]);

  // A theme switched later: the one option the instance takes a change of after it was made.
  useEffect(() => {
    connect?.update({ appearance: appearanceFor(resolvedTheme) });
  }, [connect, resolvedTheme]);

  if (connect === null) return <Skeleton className="h-96 w-full rounded-xl" />;

  return (
    <ConnectComponentsProvider connectInstance={connect}>
      <div className="flex flex-col gap-6">
        <ConnectNotificationBanner />
        {enabled ? (
          <ConnectPayouts />
        ) : (
          <ConnectAccountOnboarding
            onExit={() => {
              void checkWithStripe();
            }}
          />
        )}
      </div>
    </ConnectComponentsProvider>
  );
};
