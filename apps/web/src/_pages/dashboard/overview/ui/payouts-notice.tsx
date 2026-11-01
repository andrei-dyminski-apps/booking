import { WalletIcon } from "lucide-react";
import { HostAccountStatus } from "@repo/contracts";
import { ApiResponseError, ApiUnreachableError, payoutsApi } from "#shared/api";
import { ROUTES } from "#shared/config";
import { ButtonLink } from "#shared/ui";

/**
 * "Set up payouts" until the host's account can receive transfers. The page renders it
 * inside a `Suspense` boundary: it is a second read of the API, of a row the listings do
 * not depend on, so they are not made to wait for it. It degrades like `AskHost`: an
 * account that cannot be read draws no notice rather than failing a screen that needs
 * none — the payouts page is where the status matters.
 */
export const PayoutsNotice = async () => {
  if (await enabledOrUnknown()) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Set up payouts to get paid</p>
        <p className="text-sm text-muted-foreground">
          Your listings take bookings as usual; what they earn waits until
          Stripe knows where to send it.
        </p>
      </div>
      <ButtonLink
        href={ROUTES.payouts}
        variant="outline"
        className="w-full sm:w-auto"
      >
        <WalletIcon />
        Set up payouts
      </ButtonLink>
    </div>
  );
};

async function enabledOrUnknown(): Promise<boolean> {
  try {
    return (await payoutsApi.account()).status === HostAccountStatus.ENABLED;
  } catch (error) {
    if (
      error instanceof ApiResponseError ||
      error instanceof ApiUnreachableError
    ) {
      return true;
    }

    throw error;
  }
}
