import { WarehouseIcon } from "lucide-react";
import { listingQuerySchema, Role } from "@repo/contracts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import { requireRole } from "#shared/api";
import { ROUTES } from "#shared/config";
import { filtersHref, singleParam } from "#shared/lib";
import { Pager, StalePageNotice } from "#shared/ui";
import { readListingsPage } from "../api/read-listings-page";
import { AdminListingCard } from "./admin-listing-card";

/**
 * The admin's half of the catalogue: every listing on offer, each of them editable — the
 * screen phase 3 left waiting for the catalogue to exist. It is the catalogue's own read
 * (`GET /listings`), because an admin's question is "what is on offer" exactly as a
 * guest's is; what differs is the link on each card, and the API is what decides that it
 * works — `PATCH` and `DELETE` let an admin through on any row.
 *
 * Only the cursor travels in the URL. Searching what is on offer is the catalogue's job,
 * and that screen is one link away; this one is for walking the list and acting on a row.
 * Any other parameter is ignored rather than refused, because nothing here reads it.
 *
 * Retired listings are not here, and that is the catalogue's rule rather than a choice of
 * this screen: a retired row answers `404` by id to everybody, and nothing in the API
 * lists them back.
 */
export const AdminListingsPage = async ({
  searchParams,
}: PageProps<"/admin">) => {
  await requireRole(Role.ADMIN, ROUTES.admin);

  const cursor = singleParam((await searchParams).cursor);
  const query = listingQuerySchema.parse({ cursor });
  const page = await readListingsPage(query);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Listings</h1>
        <p className="text-sm text-muted-foreground">
          Every listing on offer, newest first. An admin may edit or retire any
          of them; creating one stays the owner&apos;s.
        </p>
      </div>

      {page === null && <StalePageNotice firstPageHref={ROUTES.admin} />}

      {page !== null &&
        (page.items.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WarehouseIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing on offer</EmptyTitle>
              <EmptyDescription>
                No owner has published a listing yet, or every one has been
                retired.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul role="list" className="grid gap-4 sm:grid-cols-2">
            {page.items.map((listing) => (
              <li key={listing.id}>
                <AdminListingCard listing={listing} />
              </li>
            ))}
          </ul>
        ))}

      {page !== null && (
        <Pager
          nextHref={
            page.nextCursor !== null
              ? filtersHref(ROUTES.admin, {}, page.nextCursor)
              : null
          }
          firstHref={query.cursor !== undefined ? ROUTES.admin : null}
        />
      )}
    </div>
  );
};
