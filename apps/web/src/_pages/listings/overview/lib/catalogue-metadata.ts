import type { Metadata } from "next";
import { ROUTES, SITE_NAME } from "#shared/config";
import { catalogueHref, readCatalogueSearch } from "./catalogue-search";

const TITLE = "Stays";
const DESCRIPTION =
  "Every listing on offer, searched by dates, price and guests.";

/**
 * What to index of the catalogue is half of its SEO, and the answer is the bare
 * `/listings` and nothing else. Every other address is the same rows narrowed or
 * reordered: an ordering is the first page again in another order, a price and a guest
 * count are unbounded and each one near-identical to its neighbour, and a pair of dates
 * stops being a search the contract takes the day it passes. Indexed, each would be a
 * duplicate under one title competing with the catalogue itself. A crawler reaches every
 * listing through the sitemap and the bare catalogue's own links instead.
 *
 * So every other address — a search, a cursor page, a search the contract refuses — is
 * left out of the index with its links still followed, and names no canonical: `noindex`
 * beside a canonical pointing elsewhere are two answers to one question, and Google
 * advises against sending both. The shared link names the search without the cursor, the
 * one somebody can open again, or the bare catalogue when the search is one the contract
 * refuses.
 *
 * An address the page is about to redirect away from is never rendered, so it needs no
 * rule here.
 */
export const generateCatalogueMetadata = async ({
  searchParams,
}: PageProps<"/listings">): Promise<Metadata> => {
  const { query, values } = readCatalogueSearch(await searchParams);
  const search = query === null ? ROUTES.catalogue : catalogueHref(values);
  const indexed =
    query !== null && query.cursor === undefined && search === ROUTES.catalogue;

  return {
    title: TITLE,
    description: DESCRIPTION,
    ...(indexed
      ? { alternates: { canonical: ROUTES.catalogue } }
      : { robots: { index: false, follow: true } }),
    // A page's `openGraph` replaces the layout's whole rather than merging into it.
    openGraph: {
      siteName: SITE_NAME,
      type: "website",
      title: TITLE,
      description: DESCRIPTION,
      url: search,
    },
  };
};
