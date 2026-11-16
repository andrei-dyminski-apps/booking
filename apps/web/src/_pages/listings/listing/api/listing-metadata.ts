import type { Metadata } from "next";
import { ROUTES, SITE_NAME } from "#shared/config";
import { orNotFound, requireId } from "#shared/lib";
import { descriptionSummary } from "../lib/description-summary";
import { readListing } from "./read-listing";

/**
 * The listing's title, description and shared link, all three off the row the page
 * renders — the same cached read, so a missing or retired listing is the route's 404
 * here too.
 */
export const generateListingMetadata = async ({
  params,
}: PageProps<"/listings/[id]">): Promise<Metadata> => {
  const id = requireId((await params).id);
  const listing = await orNotFound(readListing(id));
  const description = descriptionSummary(listing.description);
  const path = ROUTES.listing(listing.id);

  return {
    title: listing.title,
    description,
    alternates: { canonical: path },
    // A page's `openGraph` replaces the layout's whole rather than merging into it.
    openGraph: {
      siteName: SITE_NAME,
      type: "website",
      title: listing.title,
      description,
      url: path,
    },
  };
};
