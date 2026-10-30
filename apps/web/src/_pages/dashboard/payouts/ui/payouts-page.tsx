import {
  HostAccountStatus,
  PAYOUT_DELAY_HOURS,
  PLATFORM_FEE_RATE,
  Role,
} from "@repo/contracts";
import { payoutsApi, requireRole } from "#shared/api";
import { ROUTES, stripePublishableKey } from "#shared/config";
import { countOf } from "#shared/lib";
import { BackLink, PageHeading } from "#shared/ui";
import { PayoutsPanel } from "./payouts-panel";

/**
 * Where a host is paid: Stripe's onboarding form until their account can receive
 * transfers, then the payouts it has received. Both are Stripe's embedded components — the
 * details a host gives for payouts go from the browser to Stripe and never through this
 * site, the argument Elements makes for a card.
 *
 * The status is read on the server, so the page opens on the right one of the two; the
 * components themselves only run in the browser and ask for their own session.
 */
export const PayoutsPage = async () => {
  await requireRole(Role.USER, ROUTES.payouts);

  const { status } = await payoutsApi.account();
  const feePercent = Math.round(PLATFORM_FEE_RATE * 100);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <BackLink href={ROUTES.dashboard}>Dashboard</BackLink>
        <PageHeading
          title="Payouts"
          description={`Guests pay the site; you are paid your share ${countOf(PAYOUT_DELAY_HOURS, "hour")} after each stay begins — everything left after refunds, less the site's ${String(feePercent)}%.`}
        />
      </div>

      <PayoutsPanel
        enabled={status === HostAccountStatus.ENABLED}
        publishableKey={stripePublishableKey()}
      />
    </div>
  );
};
