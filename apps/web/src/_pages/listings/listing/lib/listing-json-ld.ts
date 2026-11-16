import {
  CURRENCY,
  MAX_RATING,
  MIN_RATING,
  type Listing,
  type ReviewSummary,
} from "@repo/contracts";
import { ROUTES, SITE_NAME, siteUrl } from "#shared/config";
import { breadcrumbJsonLd, inputOfCents, type JsonLdNode } from "#shared/lib";

/**
 * What a crawler reads the listing's page by, built from the row the page renders and the
 * summary of reviews it draws — never from a read of its own, so the document cannot say
 * anything the page beside it does not.
 *
 * A `VacationRental` holding the `Accommodation` it lets — `occupancy` is the
 * accommodation's, not the business's — and an `Offer` at the default nightly price, the
 * one the page's badge states. What stays out is `availability`: the calendar answers it
 * per night, and the document would be a promise about dates it cannot make for the
 * listing as a whole. The rating is there only once somebody has rated it: `average` is
 * `null` before then, and an `AggregateRating` of nothing is one a crawler refuses. Its
 * value is rounded the way the page's summary rounds it, through `toFixed(1)` itself: a
 * `Math.round(x * 10)` parts with it at an average such as 87 / 20, which is 4.3 there.
 *
 * It is what a crawler reads the page by, not a rich result: Google's vacation-rental
 * result is a partner programme that also wants photos, an address and coordinates the
 * contract does not hold, and a rating a business states on its own site is one Google
 * draws no stars for.
 */
export function listingJsonLd(
  listing: Listing,
  reviews: ReviewSummary | null,
): JsonLdNode[] {
  const url = siteUrl(ROUTES.listing(listing.id));

  return [
    {
      "@type": "VacationRental",
      "@id": `${url}#listing`,
      identifier: listing.id,
      url,
      name: listing.title,
      description: listing.description,
      containsPlace: {
        "@type": "Accommodation",
        occupancy: {
          "@type": "QuantitativeValue",
          maxValue: listing.capacity,
        },
      },
      makesOffer: {
        "@type": "Offer",
        url,
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: inputOfCents(listing.pricePerNightCents),
          priceCurrency: CURRENCY.toUpperCase(),
          unitCode: "DAY",
          unitText: "night",
        },
      },
      aggregateRating:
        reviews !== null && reviews.average !== null
          ? {
              "@type": "AggregateRating",
              ratingValue: Number(reviews.average.toFixed(1)),
              ratingCount: reviews.count,
              bestRating: MAX_RATING,
              worstRating: MIN_RATING,
            }
          : undefined,
    },
    breadcrumbJsonLd([
      { name: SITE_NAME, url: siteUrl(ROUTES.home) },
      { name: "Stays", url: siteUrl(ROUTES.catalogue) },
      { name: listing.title, url },
    ]),
  ];
}
