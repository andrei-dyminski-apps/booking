import { Suspense, type ReactNode } from "react";
import {
  HostAccountStatus,
  BASIS_POINTS,
  PAYOUT_DELAY_HOURS,
  PLATFORM_FEE_BPS,
  Role,
} from "@repo/contracts";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Skeleton } from "@repo/ui/components/skeleton";
import { HostFees } from "#entities/host-fee";
import { hostFeesApi, payoutsApi, requireRole } from "#shared/api";
import { ROUTES, stripePublishableKey } from "#shared/config";
import { countOf, readerTimeZone } from "#shared/lib";
import { BackLink, PageHeading } from "#shared/ui";
import { readPayoutCountries } from "../api/read-payout-countries";
import { countryOptions } from "../lib/country-options";
import { OpenAccountForm } from "./open-account-form";
import { PayoutsPanel } from "./payouts-panel";

/**
 * Where a host is paid: the country to open their account in, Stripe's onboarding form
 * until the account can receive transfers, then the payouts it has received. The country
 * is this site's own form, and goes to the API; the last two are Stripe's embedded
 * components — the details a host gives for payouts go from the browser to Stripe and never
 * through this site, the argument Elements makes for a card.
 *
 * The status is read on the server, so the page opens on the right one of the three, and so
 * are the countries Stripe lets the account be opened in; the components themselves only
 * run in the browser and ask for their own session.
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

      {status === HostAccountStatus.NOT_STARTED ? (
        // Streamed too: the countries are Stripe's answer, which the API may still be
        // reading — the heading and the fees do not wait for it.
        <Suspense fallback={<OpenAccountSkeleton />}>
          <OpenAccount />
        </Suspense>
      ) : (
        <PayoutsPanel
          enabled={status === HostAccountStatus.ENABLED}
          publishableKey={stripePublishableKey()}
        />
      )}
    </div>
  );
};

/** Read only for a host with no account yet, the one state that offers the form. */
const OpenAccount = async () => {
  const countries = await readPayoutCountries();

  if (countries === null) {
    return (
      <OpenAccountUnavailable>
        Payouts cannot be set up right now. Reload the page to try again.
      </OpenAccountUnavailable>
    );
  }

  // An empty answer is Stripe's, not an outage: a select with nothing in it would be a form
  // that cannot be filled, and a reload would not change what Stripe says.
  if (countries.length === 0) {
    return (
      <OpenAccountUnavailable>
        Payouts cannot be sent to any country yet. Please check back later.
      </OpenAccountUnavailable>
    );
  }

  return <OpenAccountForm countries={countryOptions(countries)} />;
};

const OpenAccountUnavailable = ({ children }: { children: ReactNode }) => (
  <Card>
    <CardHeader>
      <CardTitle>Set up payouts</CardTitle>
      <CardDescription>{children}</CardDescription>
    </CardHeader>
  </Card>
);

/** The form's frame while the countries are read: its heading, the box and the button. */
const OpenAccountSkeleton = () => (
  <div className="flex flex-col gap-6 rounded-xl border p-4 sm:p-6">
    <div className="flex flex-col gap-1">
      <h2 className="text-base font-medium">Set up payouts</h2>
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-10 w-full sm:max-w-sm" />
    </div>
    <Skeleton className="h-9 w-full sm:w-24" />
  </div>
);
