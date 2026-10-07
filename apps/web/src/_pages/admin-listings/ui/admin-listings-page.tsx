import { ArrowLeftIcon, WarehouseIcon } from "lucide-react";
import { listingQuerySchema, Role } from "@repo/contracts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import { anyUser } from "#entities/user";
import { requireRole } from "#shared/api";
import { ROUTES } from "#shared/config";
import { filtersHref, requireId, singleParam } from "#shared/lib";
import { ButtonLink, Pager, StalePageNotice } from "#shared/ui";
import { readListingsPage } from "../api/read-listings-page";
import { AdminListingCard } from "./admin-listing-card";

/**
 * The admin's half of the catalogue: every listing on offer, each of them editable — the
 * screen phase 3 left waiting for the catalogue to exist. It is the catalogue's own read
 * (`GET /listings`), because an admin's question is "what is on offer" exactly as a
 * guest's is; what differs is the link on each card, and the API is what decides that it
 * works — `PATCH` and `DELETE` let an admin through on any row.
 *
 * Only the cursor and `ownerId` travel in the URL. Searching what is on offer is the
 * catalogue's job, and that screen is one link away; this one is for walking the list and
 * acting on a row. `ownerId` is how an account's own page links to what it offers, and it
 * is a link rather than a box — an id that names nobody is the 404 any other id gets. Any
 * other parameter is ignored rather than refused, because nothing here reads it.
 *
 * Retired listings are not here, and that is the catalogue's rule rather than a choice of
 * this screen: a retired row answers `404` by id to everybody, and nothing in the API
 * lists them back.
 */
export const AdminListingsPage = async ({
  searchParams,
}: PageProps<"/admin">) => {
  const params = await searchParams;
  const ownerParam = singleParam(params.ownerId);
  const ownerId = ownerParam === "" ? "" : requireId(ownerParam);
  const listHref = filtersHref(ROUTES.admin, { ownerId });

  await requireRole(Role.ADMIN, listHref);

  const cursor = singleParam(params.cursor);
  const query = listingQuerySchema.parse({ cursor, ownerId });
  const [page, owner] = await Promise.all([
    readListingsPage(query),
    ownerId === "" ? null : anyUser(ownerId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      {owner === null ? (
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Listings</h1>
          <p className="text-sm text-muted-foreground">
            Every listing on offer, newest first. An admin may edit or retire
            any of them; creating one stays the owner&apos;s.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <ButtonLink
            href={ROUTES.adminUser(owner.id)}
            variant="ghost"
            size="sm"
            className="-ml-2 self-start"
          >
            <ArrowLeftIcon />
            Back to the account
          </ButtonLink>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Listings</h1>
            <p className="text-sm break-all text-muted-foreground">
              What {owner.email} has on offer, newest first.
            </p>
            <ButtonLink
              href={ROUTES.admin}
              variant="link"
              size="sm"
              className="self-start px-0"
            >
              Show every listing
            </ButtonLink>
          </div>
        </div>
      )}

      {page === null && <StalePageNotice firstPageHref={listHref} />}

      {page !== null &&
        (page.items.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WarehouseIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing on offer</EmptyTitle>
              <EmptyDescription>
                {owner === null
                  ? "No owner has published a listing yet, or every one has been retired."
                  : "This account has no listing on offer."}
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
              ? filtersHref(ROUTES.admin, { ownerId }, page.nextCursor)
              : null
          }
          firstHref={query.cursor !== undefined ? listHref : null}
        />
      )}
    </div>
  );
};
