import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listingSchema, type Listing } from "@repo/contracts";
import { catalogueJsonLd } from "./catalogue-json-ld";

const listing = (id: string, title: string): Listing =>
  listingSchema.parse({
    id,
    ownerId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    title,
    description: "A place to stay for a while.",
    pricePerNightCents: 10_000,
    capacity: 2,
    cancellationPolicy: "FLEXIBLE",
    nonRefundableDiscountBps: null,
    timeZone: "Europe/Berlin",
    checkInTime: "15:00",
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z",
  });

const ROWS = [
  listing("7f1c2a4e-3b5d-4e6f-8a9b-0c1d2e3f4a5b", "Loft by the river"),
  listing("2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", "Cabin in the woods"),
];

beforeEach(() => {
  vi.stubEnv("SITE_ORIGIN", "https://stays.example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("catalogueJsonLd", () => {
  it("lists the rows the page drew, in its order, at the address it is served at", () => {
    const list = catalogueJsonLd(ROWS, "/listings?guests=2").find(
      (node) => node["@type"] === "ItemList",
    );

    expect(list).toEqual({
      "@type": "ItemList",
      url: "https://stays.example.com/listings?guests=2",
      numberOfItems: 2,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          url: "https://stays.example.com/listings/7f1c2a4e-3b5d-4e6f-8a9b-0c1d2e3f4a5b",
          name: "Loft by the river",
        },
        {
          "@type": "ListItem",
          position: 2,
          url: "https://stays.example.com/listings/2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
          name: "Cabin in the woods",
        },
      ],
    });
  });

  it("states no list on an empty page, only the trail", () => {
    expect(
      catalogueJsonLd([], "/listings").map((node) => node["@type"]),
    ).toEqual(["BreadcrumbList"]);
  });
});
