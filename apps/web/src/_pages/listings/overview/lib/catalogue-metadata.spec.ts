import { describe, expect, it } from "vitest";
import { generateCatalogueMetadata } from "./catalogue-metadata";

const metadataOf = (searchParams: Record<string, string>) =>
  generateCatalogueMetadata({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(searchParams),
  });

const LEFT_OUT = { index: false, follow: true };

describe("generateCatalogueMetadata", () => {
  it("indexes the bare catalogue under its own address", async () => {
    const metadata = await metadataOf({});

    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates?.canonical).toBe("/listings");
  });

  it("keeps a filtered search out of the index, its links followed and no canonical beside it", async () => {
    const metadata = await metadataOf({ guests: "3", minPrice: "100" });

    expect(metadata.robots).toEqual(LEFT_OUT);
    expect(metadata.alternates).toBeUndefined();
  });

  it("keeps another ordering of the same rows out of the index", async () => {
    const metadata = await metadataOf({ sort: "priceAsc" });

    expect(metadata.robots).toEqual(LEFT_OUT);
    expect(metadata.alternates).toBeUndefined();
  });

  it("keeps a search by dates out of the index", async () => {
    const metadata = await metadataOf({ from: "2030-01-02", to: "2030-01-05" });

    expect(metadata.robots).toEqual(LEFT_OUT);
  });

  it("keeps a cursor page of the bare catalogue out of the index", async () => {
    const metadata = await metadataOf({ cursor: "b3BhcXVl" });

    expect(metadata.robots).toEqual(LEFT_OUT);
    expect(metadata.alternates).toBeUndefined();
  });

  it("shares a cursor page as the search without the cursor", async () => {
    const metadata = await metadataOf({ guests: "3", cursor: "b3BhcXVl" });

    expect(metadata.openGraph?.url).toBe("/listings?guests=3");
  });

  it("keeps a search the contract refuses out of the index and shares the bare catalogue", async () => {
    const metadata = await metadataOf({ from: "2030-01-02" });

    expect(metadata.robots).toEqual(LEFT_OUT);
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph?.url).toBe("/listings");
  });
});
