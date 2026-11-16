import type { Listing } from "@repo/contracts";
import { ROUTES, SITE_NAME, siteUrl } from "#shared/config";
import { breadcrumbJsonLd, type JsonLdNode } from "#shared/lib";

/**
 * The page of the catalogue that was asked for, as a crawler reads it: the rows it
 * already drew, in the order it drew them, under the address of its search. A filtered
 * search and a cursor page each describe themselves rather than the catalogue as a whole
 * — positions start at one on every page, since a cursor is opaque and says nothing about
 * how many rows came before it, and a cursor page is kept out of the index anyway.
 *
 * `searchHref` is the search without its cursor, the address the shared link names too: a
 * cursor is one answer's continuation rather than an address anybody can open again.
 */
export function catalogueJsonLd(
  rows: readonly Listing[],
  searchHref: string,
): JsonLdNode[] {
  const trail = breadcrumbJsonLd([
    { name: SITE_NAME, url: siteUrl(ROUTES.home) },
    { name: "Stays", url: siteUrl(ROUTES.catalogue) },
  ]);

  // An empty list states nothing a crawler can use; the trail is still the page's.
  if (rows.length === 0) return [trail];

  return [
    {
      "@type": "ItemList",
      url: siteUrl(searchHref),
      numberOfItems: rows.length,
      itemListElement: rows.map((listing, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: siteUrl(ROUTES.listing(listing.id)),
        name: listing.title,
      })),
    },
    trail,
  ];
}
