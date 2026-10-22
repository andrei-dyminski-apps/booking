import { PlusIcon, WarehouseIcon } from "lucide-react";
import { Role } from "@repo/contracts";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import { ListingCard } from "#entities/listing";
import { listingsApi, requireRole } from "#shared/api";
import { ROUTES } from "#shared/config";
import { ButtonLink, PageHeading } from "#shared/ui";

/**
 * A user's listings: what `GET /listings/mine` returns is decided by the session rather
 * than by a parameter, so this page has no filter to get wrong. Hosting is not a role, so
 * every user reaches it — it is where the first listing is published from — and an admin,
 * who has no listings of their own, does not.
 *
 * The read is personal and therefore `no-store` — the Data Cache is keyed by URL and
 * shared between visitors, and one owner's listings must never be served to the next.
 */
export const ListingsPage = async () => {
  await requireRole(Role.USER, ROUTES.dashboard);

  const listings = await listingsApi.mine({ cache: "no-store" });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeading
          title="Dashboard"
          description="The listings you own. Guests book them; only you and an admin can change them."
        />

        <ButtonLink href={ROUTES.newListing}>
          <PlusIcon />
          New listing
        </ButtonLink>
      </div>

      {listings.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WarehouseIcon />
            </EmptyMedia>
            <EmptyTitle>No listings yet</EmptyTitle>
            <EmptyDescription>
              The first one is a single form: a title, what it costs a night and
              how many it sleeps.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <ButtonLink href={ROUTES.newListing}>
              <PlusIcon />
              New listing
            </ButtonLink>
          </EmptyContent>
        </Empty>
      ) : (
        <ul role="list" className="grid gap-4 sm:grid-cols-2">
          {listings.map((listing) => (
            <li key={listing.id}>
              <ListingCard
                listing={listing}
                editHref={ROUTES.editListing(listing.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
