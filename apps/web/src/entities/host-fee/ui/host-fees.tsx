import type { ReactNode } from "react";
import type { HostFee, HostFeeOverview } from "@repo/contracts";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { ApiResponseError, ApiUnreachableError } from "#shared/api";
import { HostFeesCard } from "./host-fees-card";

/**
 * A host's cancellation fees as a section of a screen that is about something else — the
 * host's payouts, the admin's page of an account. Both render it inside a `Suspense`
 * boundary: it is a second read of the API, and the screen is not made to wait for it.
 *
 * Which read it is stays with the screen (`read`): the host's own or one host's for an
 * admin. An API that cannot answer is said in a line rather than drawn as no card, unlike
 * `PayoutsNotice`: no card already means "nothing owed", and a host or an admin told that
 * by a failed read would be told something untrue. Anything else — a drift from the
 * contract above all — is thrown to the boundary.
 */
export const HostFees = async ({
  read,
  audience,
  readerTimeZone,
  action,
}: {
  read: () => Promise<HostFeeOverview>;
  audience: "host" | "admin";
  /** The reader's zone, which the moments are stated in (`readerTimeZone`). */
  readerTimeZone: string;
  action?: (fee: HostFee) => ReactNode;
}) => {
  const overview = await readOrUnavailable(read);

  if (overview === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cancellation fees</CardTitle>
          <CardDescription>
            The fees could not be loaded right now. Reload the page to try
            again.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <HostFeesCard
      overview={overview}
      audience={audience}
      readerTimeZone={readerTimeZone}
      action={action}
    />
  );
};

async function readOrUnavailable(
  read: () => Promise<HostFeeOverview>,
): Promise<HostFeeOverview | null> {
  try {
    return await read();
  } catch (error) {
    if (
      error instanceof ApiResponseError ||
      error instanceof ApiUnreachableError
    ) {
      return null;
    }

    throw error;
  }
}
