import { redirect } from "next/navigation";
import { WarehouseIcon } from "lucide-react";
import { Role } from "@repo/contracts";
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
import { today } from "#shared/lib";
import {
  BackLink,
  NoMatchesNotice,
  PageHeading,
  Pager,
  RefusedSearchNotice,
  StalePageNotice,
} from "#shared/ui";
import { readListingsPage } from "../api/read-listings-page";
import {
  activeFilters,
  adminListingsHref,
  readAdminListingsSearch,
} from "../lib/admin-listings-search";
import { AdminListingCard } from "./admin-listing-card";
import { AdminListingsToolbar } from "./admin-listings-toolbar";

/**
 * The admin's half of the catalogue: every listing on offer, each of them editable — the
 * screen phase 3 left waiting for the catalogue to exist. It is the catalogue's own read
 * (`GET /listings`), because an admin's question is "what is on offer" exactly as a
 * guest's is; what differs is the link on each card, and the API is what decides that it
 * works — `PATCH` and `DELETE` let an admin through on any row.
 *
 * The filters are the catalogue's — dates, prices, guests and the ordering — plus
 * `ownerId`, and they live in the URL with the shape every other list here has: one search
 * at one address, a refusal shown under its box, a page that reads `no-store`. `ownerId`
 * is how an account's own page links to what it offers; an id that parses and names
 * nobody is the 404 any other id gets.
 *
 * Retired listings are not here, and that is the catalogue's rule rather than a choice of
 * this screen: a retired row answers `404` by id to everybody, and nothing in the API
 * lists them back.
 */
export const AdminListingsPage = async ({
  searchParams,
}: PageProps<"/admin">) => {
  const { query, ownerId, errors, values, canonical } = readAdminListingsSearch(
    await searchParams,
  );

  await requireRole(Role.ADMIN, adminListingsHref(values));

  // One search, one address — see `canonical` in `catalogue-search.ts`.
  if (canonical !== null) redirect(canonical);

  // The owner is read whenever the id parses, the list only when the whole search does:
  // a refused date range still belongs to the account it was asked about.
  const [page, owner] = await Promise.all([
    query === null ? null : readListingsPage(query),
    ownerId === null ? null : anyUser(ownerId),
  ]);
  const staleCursor = query !== null && page === null;
  const filters = activeFilters(values, { owner: owner?.email });
  // The owner narrows the list to one account rather than searching it, so an empty
  // answer under that alone is the account's own empty state, not a search nothing matched.
  const searched = filters.some((filter) => filter.key !== "ownerId");

  return (
    <div className="flex flex-col gap-6">
      {owner !== null && (
        <BackLink href={ROUTES.adminUser(owner.id)}>
          Back to the account
        </BackLink>
      )}

      <PageHeading
        title="Listings"
        description={
          owner === null
            ? "Every listing on offer. An admin may edit or retire any of them; creating one stays the owner's."
            : `What ${owner.email} has on offer.`
        }
      />

      <AdminListingsToolbar
        values={values}
        errors={errors}
        filters={filters}
        earliest={today()}
        ownerLabel={owner?.email}
      />

      {staleCursor && (
        <StalePageNotice firstPageHref={adminListingsHref(values)} />
      )}

      {page !== null &&
        (page.items.length === 0 ? (
          searched ? (
            <NoMatchesNotice />
          ) : (
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
          )
        ) : (
          <ul role="list" className="grid gap-4 sm:grid-cols-2">
            {page.items.map((listing) => (
              <li key={listing.id}>
                <AdminListingCard listing={listing} />
              </li>
            ))}
          </ul>
        ))}

      {query === null && <RefusedSearchNotice />}

      {page !== null && (
        <Pager
          nextHref={
            page.nextCursor !== null
              ? adminListingsHref(values, page.nextCursor)
              : null
          }
          firstHref={
            query?.cursor !== undefined ? adminListingsHref(values) : null
          }
        />
      )}
    </div>
  );
};
