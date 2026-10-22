import { describe, expect, it } from "vitest";
import {
  activeFilters,
  catalogueHref,
  clearedFiltersHref,
  readCatalogueSearch,
  sortOptions,
} from "./catalogue-search";

const NO_FILTERS = {
  from: "",
  to: "",
  minPrice: "",
  maxPrice: "",
  guests: "",
  sort: "",
};

describe("readCatalogueSearch", () => {
  it("asks the unfiltered question when the URL carries nothing", () => {
    const { query, errors, values } = readCatalogueSearch({});

    expect(query).toEqual({ limit: 20, sort: "newest" });
    expect(errors).toEqual({});
    expect(values).toEqual(NO_FILTERS);
  });

  it("reads an empty box as an absent filter rather than as an empty string", () => {
    // What a GET form submits for a filter nobody filled in.
    const { query } = readCatalogueSearch({
      from: "",
      to: "",
      minPrice: "",
      guests: "",
    });

    expect(query).toEqual({ limit: 20, sort: "newest" });
  });

  it("coerces the numbers the way the contract does", () => {
    const { query } = readCatalogueSearch({
      minPrice: "50",
      maxPrice: "200.50",
      guests: "3",
    });

    expect(query).toEqual({
      limit: 20,
      sort: "newest",
      minPrice: 50,
      maxPrice: 200.5,
      guests: 3,
    });
  });

  it("keeps half a date range out of the API and reports it under the second box", () => {
    const { query, errors, values } = readCatalogueSearch({
      from: "2030-01-02",
    });

    expect(query).toBeNull();
    expect(errors.to).toHaveLength(1);
    // The box keeps what was typed: the message is about the one next to it.
    expect(values.from).toBe("2030-01-02");
  });

  it("refuses a check-out that is not after the check-in", () => {
    const { query, errors } = readCatalogueSearch({
      from: "2030-01-02",
      to: "2030-01-02",
    });

    expect(query).toBeNull();
    expect(errors.to).toHaveLength(1);
  });

  it("refuses a lowest price above the highest", () => {
    const { query, errors } = readCatalogueSearch({
      minPrice: "200",
      maxPrice: "50",
    });

    expect(query).toBeNull();
    expect(errors.maxPrice).toHaveLength(1);
  });

  it("refuses a price finer than a cent", () => {
    // The URL is where a third decimal comes from — a box steps in cents, and a link
    // somebody wrote by hand does not. The contract refuses it rather than rounding it
    // away, so the message belongs under the box it came out of.
    const { query, errors } = readCatalogueSearch({ minPrice: "50.005" });

    expect(query).toBeNull();
    expect(errors.minPrice).toHaveLength(1);
  });

  it("takes a price at the ceiling and refuses the cent above it", () => {
    // The top of the range is where the cent rule and the ceiling meet, and a filter is
    // the one place a visitor types a price without a form to bound it. A refusal at
    // 999999.99 would be a box they cannot correct; one at 1000000.01 is the contract.
    const { query, errors } = readCatalogueSearch({ maxPrice: "999999.99" });

    expect(errors.maxPrice).toBeUndefined();
    expect(query?.maxPrice).toBe(999_999.99);

    expect(
      readCatalogueSearch({ maxPrice: "1000000.01" }).errors.maxPrice,
    ).toHaveLength(1);
  });

  it("refuses a filter that is not a number at all", () => {
    const { query, errors } = readCatalogueSearch({ guests: "many" });

    expect(query).toBeNull();
    expect(errors.guests).toHaveLength(1);
  });

  it("drops a parameter the URL repeats instead of guessing which one was meant", () => {
    const { query, values } = readCatalogueSearch({ guests: ["2", "8"] });

    expect(query).toEqual({ limit: 20, sort: "newest" });
    expect(values.guests).toBe("");
  });

  it("carries the cursor through untouched — only the API can read it", () => {
    const { query } = readCatalogueSearch({ cursor: "b3BhcXVl" });

    expect(query).toEqual({ limit: 20, sort: "newest", cursor: "b3BhcXVl" });
  });

  it("reads the ordering the URL asks for", () => {
    const { query, values } = readCatalogueSearch({ sort: "priceAsc" });

    expect(query).toEqual({ limit: 20, sort: "priceAsc" });
    expect(values.sort).toBe("priceAsc");
  });

  it("refuses an ordering the contract does not offer", () => {
    // It is one of four names or it is nothing: the API indexes exactly those pairs, so
    // quietly falling back to the newest would answer a different question than the link.
    const { query, errors } = readCatalogueSearch({ sort: "cheapest" });

    expect(query).toBeNull();
    expect(errors.sort).toHaveLength(1);
  });
});

describe("readCatalogueSearch, the address it belongs at", () => {
  it("leaves an address that is already the one this slice writes", () => {
    expect(readCatalogueSearch({}).canonical).toBeNull();
    expect(
      readCatalogueSearch({ guests: "3", sort: "priceAsc" }).canonical,
    ).toBeNull();
    expect(
      readCatalogueSearch({ guests: "3", cursor: "b3BhcXVl" }).canonical,
    ).toBeNull();
  });

  it("drops the empty boxes a GET form submits beside the one that was filled in", () => {
    const { canonical } = readCatalogueSearch({
      from: "",
      to: "",
      minPrice: "100",
      maxPrice: "",
      guests: "",
      sort: "",
    });

    expect(canonical).toBe("/listings?minPrice=100");
  });

  it("writes the parameters in the order every link of this slice writes them", () => {
    // Otherwise the same search is two addresses again, one of them written by a form and
    // the other by a chip.
    expect(
      readCatalogueSearch({ sort: "priceAsc", guests: "3" }).canonical,
    ).toBe("/listings?guests=3&sort=priceAsc");
  });

  it("drops what the catalogue does not take, and a parameter the URL repeats", () => {
    expect(readCatalogueSearch({ guests: "3", ref: "email" }).canonical).toBe(
      "/listings?guests=3",
    );
    expect(readCatalogueSearch({ guests: ["2", "8"] }).canonical).toBe(
      "/listings",
    );
  });

  it("canonicalises a search the contract refuses as well", () => {
    // The boxes and the message about them are what this address is for, so it is the one
    // the mistake is corrected at.
    const { query, canonical } = readCatalogueSearch({
      sort: "cheapest",
      guests: "",
    });

    expect(query).toBeNull();
    expect(canonical).toBe("/listings?sort=cheapest");
  });

  it("round-trips: the address it names is one it would leave alone", () => {
    // A redirect onto an address that redirects again is a loop, so this is the property
    // that matters rather than any single link above.
    const canonical = readCatalogueSearch({
      from: " 2030-01-02 ",
      to: "2030-01-09",
      minPrice: "",
      sort: "priceDesc",
      cursor: "b3BhcXVl",
    }).canonical;

    expect(canonical).toBe(
      "/listings?from=2030-01-02&to=2030-01-09&sort=priceDesc&cursor=b3BhcXVl",
    );

    const params = Object.fromEntries(
      new URL(canonical ?? "", "https://example.test").searchParams,
    );

    expect(readCatalogueSearch(params).canonical).toBeNull();
  });
});

describe("sortOptions", () => {
  it("offers every ordering the contract has, and marks the default when the URL is silent", () => {
    const options = sortOptions(NO_FILTERS);

    expect(options.map((option) => option.value)).toEqual([
      "newest",
      "oldest",
      "priceAsc",
      "priceDesc",
    ]);
    expect(options.filter((option) => option.current)).toHaveLength(1);
    expect(options[0]?.current).toBe(true);
  });

  it("keeps the default out of the URL and spells the other three out", () => {
    const [newest, , priceAsc] = sortOptions(NO_FILTERS);

    expect(newest?.href).toBe("/listings");
    expect(priceAsc?.href).toBe("/listings?sort=priceAsc");
  });

  it("keeps the filters and drops the cursor: a cursor names a place in one ordering", () => {
    const [, , , priceDesc] = sortOptions({
      ...NO_FILTERS,
      guests: "3",
      sort: "priceAsc",
    });

    expect(priceDesc?.href).toBe("/listings?guests=3&sort=priceDesc");
  });

  it("marks none of them current when the URL carries an ordering that is not one", () => {
    const options = sortOptions({ ...NO_FILTERS, sort: "cheapest" });

    expect(options.every((option) => !option.current)).toBe(true);
  });
});

describe("clearedFiltersHref", () => {
  it("takes every filter off and leaves the ordering where it was", () => {
    expect(
      clearedFiltersHref({ ...NO_FILTERS, guests: "3", sort: "priceAsc" }),
    ).toBe("/listings?sort=priceAsc");
  });

  it("is the bare route when the ordering is the default one too", () => {
    expect(clearedFiltersHref({ ...NO_FILTERS, guests: "3" })).toBe(
      "/listings",
    );
  });
});

describe("catalogueHref", () => {
  it("is the bare route when nothing is filtered", () => {
    expect(catalogueHref(NO_FILTERS)).toBe("/listings");
  });

  it("carries the filters that are set and leaves out the ones that are not", () => {
    expect(catalogueHref({ ...NO_FILTERS, guests: "3" })).toBe(
      "/listings?guests=3",
    );
  });

  it("adds the cursor of the next page beside them", () => {
    expect(catalogueHref({ ...NO_FILTERS, guests: "3" }, "b3BhcXVl")).toBe(
      "/listings?guests=3&cursor=b3BhcXVl",
    );
  });

  it("round-trips: the link it writes parses back to the same question", () => {
    const values = {
      from: "2030-01-02",
      to: "2030-01-09",
      minPrice: "50",
      maxPrice: "200.50",
      guests: "3",
      sort: "priceAsc",
    };
    const href = catalogueHref(values);
    const params = Object.fromEntries(
      new URL(href, "https://example.test").searchParams,
    );

    expect(readCatalogueSearch(params).values).toEqual(values);
  });
});

describe("activeFilters", () => {
  it("has nothing to show for an unfiltered search", () => {
    expect(activeFilters(NO_FILTERS)).toEqual([]);
  });

  it("names a date range as one chip, and takes both halves off together", () => {
    // Half a range is a search the contract refuses, so removing one half alone would
    // write a link the catalogue cannot answer.
    const [dates, ...rest] = activeFilters({
      ...NO_FILTERS,
      from: "2030-01-02",
      to: "2030-01-09",
    });

    expect(rest).toEqual([]);
    expect(dates?.label).toBe("2 Jan 2030 → 9 Jan 2030");
    expect(dates?.href).toBe("/listings");
  });

  it("says which half of a range is missing rather than dropping the chip", () => {
    const [dates] = activeFilters({ ...NO_FILTERS, from: "2030-01-02" });

    expect(dates?.label).toBe("2 Jan 2030 → any date");
  });

  it("shows a price to the cent and keeps the rest of the search", () => {
    const [price] = activeFilters({
      ...NO_FILTERS,
      minPrice: "120.5",
      guests: "3",
    });

    expect(price?.label).toBe("From 120.50 a night");
    expect(price?.href).toBe("/listings?guests=3");
  });

  it("carries a value the contract refuses as it was typed", () => {
    // It arrives out of a URL like every other filter: the parse has already refused the
    // search, and the chip is what lets a visitor take the refused filter off again.
    const [guests] = activeFilters({ ...NO_FILTERS, guests: "many" });

    expect(guests?.label).toBe("many guests");
    expect(guests?.href).toBe("/listings");
  });

  it("carries the ordering along: a chip takes a filter off, not the sort", () => {
    const [guests] = activeFilters({
      ...NO_FILTERS,
      guests: "3",
      sort: "priceAsc",
    });

    expect(guests?.href).toBe("/listings?sort=priceAsc");
  });

  it("removes one filter and leaves the others in the link", () => {
    const filters = activeFilters({
      ...NO_FILTERS,
      from: "2030-01-02",
      to: "2030-01-09",
      minPrice: "50",
      maxPrice: "200",
      guests: "3",
    });

    expect(filters.map((filter) => filter.key)).toEqual([
      "dates",
      "minPrice",
      "maxPrice",
      "guests",
    ]);
    expect(filters[3]?.href).toBe(
      "/listings?from=2030-01-02&to=2030-01-09&minPrice=50&maxPrice=200",
    );
  });
});
