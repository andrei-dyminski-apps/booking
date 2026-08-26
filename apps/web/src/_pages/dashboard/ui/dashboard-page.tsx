import Link from "next/link";
import { Role } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { listingsApi, requireRole } from "#shared/api";
import { ROUTES } from "#shared/config";
import { ListingCard } from "./listing-card";

/**
 * The owner's own section: what `GET /listings/mine` returns is decided by the session
 * rather than by a parameter, so this page has no filter to get wrong.
 *
 * The read is personal and therefore `no-store` — the Data Cache is keyed by URL and
 * shared between visitors, and one owner's listings must never be served to the next.
 */
export const DashboardPage = async () => {
  await requireRole(Role.OWNER, ROUTES.dashboard);

  const listings = await listingsApi.mine({ cache: "no-store" });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            The listings you own. Guests book them; only you and an admin can
            change them.
          </p>
        </div>

        <Button render={<Link href={ROUTES.newListing} />}>New listing</Button>
      </div>

      {listings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. The first listing is one form away.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  );
};
