import { Suspense } from "react";
import {
  HostAccountStatus,
  BASIS_POINTS,
  PAYOUT_DELAY_HOURS,
  PLATFORM_FEE_BPS,
  Role,
} from "@repo/contracts";
import { HostFees } from "#entities/host-fee";
import { hostFeesApi, payoutsApi, requireRole } from "#shared/api";
import { ROUTES, stripePublishableKey } from "#shared/config";
import { countOf, readerTimeZone } from "#shared/lib";
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

  const [{ status }, zone] = await Promise.all([
    payoutsApi.account(),
    readerTimeZone(),
  ]);
  // Divided once, by the basis points in a percent: a rate taken as a fraction and then
  // multiplied back is 14.499999999999998 for 1450.
  const feePercent = PLATFORM_FEE_BPS / (BASIS_POINTS / 100);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <BackLink href={ROUTES.dashboard}>Dashboard</BackLink>
        <PageHeading
          title="Payouts"
          description={`Guests pay the site; you are paid your share ${countOf(PAYOUT_DELAY_HOURS, "hour")} after each stay begins — everything left after refunds, less the site's ${String(feePercent)}%.`}
        />
      </div>

      {/* Streamed after the page: the panel does not wait for the fees. */}
      <Suspense fallback={null}>
        <HostFees
          read={hostFeesApi.mine}
          audience="host"
          readerTimeZone={zone}
        />
      </Suspense>

      <PayoutsPanel
        enabled={status === HostAccountStatus.ENABLED}
        publishableKey={stripePublishableKey()}
      />
    </div>
  );
};
