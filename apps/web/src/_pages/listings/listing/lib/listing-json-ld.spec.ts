import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listingSchema } from "@repo/contracts";
import { listingJsonLd } from "./listing-json-ld";

const listing = listingSchema.parse({
  id: "7f1c2a4e-3b5d-4e6f-8a9b-0c1d2e3f4a5b",
  ownerId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  title: "Loft by the river",
  description: "A bright loft with a view over the water.",
  pricePerNightCents: 12_050,
  capacity: 4,
  cancellationPolicy: "FLEXIBLE",
  nonRefundableDiscountBps: null,
  timeZone: "Europe/Berlin",
  checkInTime: "15:00",
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
});

const rentalOf = (nodes: ReturnType<typeof listingJsonLd>) => {
  const rental = nodes.find((node) => node["@type"] === "VacationRental");

  if (rental === undefined) throw new Error("No VacationRental was stated");

  return rental;
};

beforeEach(() => {
  vi.stubEnv("SITE_ORIGIN", "https://stays.example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("listingJsonLd", () => {
  it("states the nightly price in the currency's units and its ISO code", () => {
    expect(rentalOf(listingJsonLd(listing, null)).makesOffer).toMatchObject({
      priceSpecification: {
        price: "120.50",
        priceCurrency: "USD",
        unitCode: "DAY",
      },
    });
  });

  it("puts the capacity on the accommodation, not on the business", () => {
    expect(rentalOf(listingJsonLd(listing, null)).containsPlace).toEqual({
      "@type": "Accommodation",
      occupancy: { "@type": "QuantitativeValue", maxValue: 4 },
    });
  });

  it("names the listing by its absolute address on the site", () => {
    expect(rentalOf(listingJsonLd(listing, null)).url).toBe(
      `https://stays.example.com/listings/${listing.id}`,
    );
  });

  it("states no rating while the reviews cannot be read", () => {
    expect(
      rentalOf(listingJsonLd(listing, null)).aggregateRating,
    ).toBeUndefined();
  });

  it("states no rating before anybody has rated the listing", () => {
    expect(
      rentalOf(listingJsonLd(listing, { count: 0, average: null }))
        .aggregateRating,
    ).toBeUndefined();
  });

  it("states the rating and its scale once somebody has", () => {
    expect(
      rentalOf(listingJsonLd(listing, { count: 3, average: 4.7 }))
        .aggregateRating,
    ).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.7,
      ratingCount: 3,
      bestRating: 5,
      worstRating: 1,
    });
  });

  it("rounds the rating to the tenth the page shows", () => {
    expect(
      rentalOf(listingJsonLd(listing, { count: 3, average: 14 / 3 }))
        .aggregateRating,
    ).toMatchObject({ ratingValue: 4.7 });
  });

  it("rounds a half the way the page does, not up", () => {
    expect(
      rentalOf(listingJsonLd(listing, { count: 20, average: 87 / 20 }))
        .aggregateRating,
    ).toMatchObject({ ratingValue: 4.3 });
  });

  it("ends the trail at the listing, under the catalogue", () => {
    const trail = listingJsonLd(listing, null).find(
      (node) => node["@type"] === "BreadcrumbList",
    );

    expect(trail?.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "StayDesk",
        item: "https://stays.example.com/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Stays",
        item: "https://stays.example.com/listings",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: "Loft by the river",
        item: `https://stays.example.com/listings/${listing.id}`,
      },
    ]);
  });
});
