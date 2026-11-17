import type { MetadataRoute } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";
import { MAX_PAGE_LIMIT, type Listing } from "@repo/contracts";
import { answerOf, listingsApi, type ReadOptions } from "#shared/api";
import { CATALOGUE_TAG, ROUTES, siteUrl } from "#shared/config";

/** How many addresses one sitemap may hold, by the protocol's own limit. */
const MAX_URLS = 50_000;

/** The two addresses that are not a listing: the home page and the bare catalogue. */
const FIXED_URLS = 2;

/**
 * Every page of the unfiltered catalogue, cached under the catalogue's tag —
 * the writes that add, edit or retire a listing are the ones that change this list, and
 * they name that tag. No lifetime beside it, unlike the catalogue's own pages: a hold
 * changes what is free, never which listings exist, and no search here asks about dates.
 */
const SITEMAP_READ: ReadOptions = {
  cached: async (url) => {
    "use cache";

    cacheLife("max");
    cacheTag(CATALOGUE_TAG);

    return await answerOf(url);
  },
};

async function everyListing(): Promise<Listing[]> {
  const rows: Listing[] = [];
  let cursor: string | undefined;

  // One page after another is the only way through a keyset list: each cursor is the
  // previous answer's. The pages are the largest the contract allows, so a catalogue of a
  // few thousand rows is a few dozen cached reads.
  do {
    const page = await listingsApi.page(
      { sort: "newest", limit: MAX_PAGE_LIMIT, cursor },
      SITEMAP_READ,
    );

    rows.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined && rows.length < MAX_URLS - FIXED_URLS);

  return rows.slice(0, MAX_URLS - FIXED_URLS);
}

/**
 * The pages a crawler should find, and the only road to most listings it has: the
 * catalogue indexes its bare first page alone (`catalogue-metadata.ts`), and the pages
 * past it are `noindex`, whose links a search engine stops following once they have been
 * left out for long enough. So every listing is named here, with the moment its row last
 * changed.
 *
 * An API that cannot answer fails the request rather than answering an empty list: a
 * crawler retries a `500` later, and reads an empty sitemap as the site having nothing.
 * Past fifty thousand listings it is cut short, and `generateSitemaps` is the step after.
 *
 * Rendered per request: the API is not there to be asked while the site builds, and the
 * origin is read at runtime. `connection()` is what says so — the pages above are cached
 * reads, and without it the build would prerender the route and ask the API for them.
 */
export async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();

  const listings = await everyListing();

  return [
    { url: siteUrl(ROUTES.home) },
    { url: siteUrl(ROUTES.catalogue) },
    ...listings.map((listing) => ({
      url: siteUrl(ROUTES.listing(listing.id)),
      lastModified: listing.updatedAt,
    })),
  ];
}
