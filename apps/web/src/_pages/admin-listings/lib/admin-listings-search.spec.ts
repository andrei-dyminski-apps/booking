import { describe, expect, it } from "vitest";
import {
  activeFilters,
  adminListingsHref,
  clearedFiltersHref,
  readAdminListingsSearch,
  sortOptions,
} from "./admin-listings-search";

const NO_FILTERS = {
  ownerId: "",
  from: "",
  to: "",
  minPrice: "",
  maxPrice: "",
  guests: "",
  sort: "",
};

const OWNER_ID = "0b6f7a52-3c1e-4d8a-9f2b-5e6c7d8e9f01";

describe("readAdminListingsSearch", () => {
  it("asks the unfiltered question when the URL carries nothing", () => {
    const { query, errors, values, canonical } = readAdminListingsSearch({});

    expect(query).toEqual({ limit: 20, sort: "newest" });
    expect(errors).toEqual({});
    expect(values).toEqual(NO_FILTERS);
    expect(canonical).toBeNull();
  });

  it("carries the catalogue's filters and the owner", () => {
    const { query } = readAdminListingsSearch({
      ownerId: OWNER_ID,
      from: "2030-01-10",
      to: "2030-01-12",
      minPrice: "50",
      maxPrice: "120.5",
      guests: "3",
      sort: "priceAsc",
    });

    expect(query).toEqual({
      limit: 20,
      ownerId: OWNER_ID,
      from: "2030-01-10",
      to: "2030-01-12",
      minPrice: 50,
      maxPrice: 120.5,
      guests: 3,
      sort: "priceAsc",
    });
  });

  it("refuses an owner that is not an id, and keeps what was typed for the chip", () => {
    const { query, ownerId, errors, values } = readAdminListingsSearch({
      ownerId: "smith",
    });

    expect(query).toBeNull();
    expect(ownerId).toBeNull();
    expect(errors.ownerId).toHaveLength(1);
    expect(activeFilters(values)).toEqual([
      { key: "ownerId", label: "Owner smith", href: "/admin" },
    ]);
  });

  it("refuses half a date range under the check-out box", () => {
    const { query, errors } = readAdminListingsSearch({ from: "2030-01-10" });

    expect(query).toBeNull();
    expect(errors.to).toHaveLength(1);
  });

  it("keeps the owner when another filter is refused — the screen still names the account", () => {
    const { query, ownerId } = readAdminListingsSearch({
      ownerId: OWNER_ID,
      from: "2030-01-10",
    });

    expect(query).toBeNull();
    expect(ownerId).toBe(OWNER_ID);
    expect(readAdminListingsSearch({}).ownerId).toBeNull();
  });

  it("redirects what a GET form submits to the address the chips write", () => {
    const { canonical } = readAdminListingsSearch({
      ...NO_FILTERS,
      guests: "2",
    });

    expect(canonical).toBe("/admin?guests=2");
  });

  it("leaves the canonical address alone — a redirect that is not a fixed point loops", () => {
    const href = adminListingsHref(
      { ...NO_FILTERS, ownerId: OWNER_ID, maxPrice: "99", sort: "oldest" },
      "cursor-value",
    );
    const params = Object.fromEntries(
      new URL(href, "http://localhost").searchParams,
    );

    expect(readAdminListingsSearch(params).canonical).toBeNull();
  });

  it("drops a parameter this list does not take", () => {
    expect(readAdminListingsSearch({ utm_source: "mail" }).canonical).toBe(
      "/admin",
    );
  });
});

describe("activeFilters", () => {
  it("names the owner when the page resolved one, and keeps the ordering", () => {
    const values = {
      ...NO_FILTERS,
      ownerId: OWNER_ID,
      from: "2030-01-10",
      to: "2030-01-12",
      guests: "2",
      sort: "priceDesc",
    };

    expect(
      activeFilters(values, { owner: "owner@example.com" }).map(
        ({ key, label }) => ({ key, label }),
      ),
    ).toEqual([
      { key: "ownerId", label: "Owner owner@example.com" },
      { key: "dates", label: expect.stringMatching(/^.+ → .+$/) },
      { key: "guests", label: "2 guests" },
    ]);
    expect(activeFilters(values)[0]?.href).toBe(
      "/admin?from=2030-01-10&to=2030-01-12&guests=2&sort=priceDesc",
    );
    expect(clearedFiltersHref(values)).toBe("/admin?sort=priceDesc");
  });
});

describe("sortOptions", () => {
  it("writes the default as the bare address and drops the cursor of every option", () => {
    const options = sortOptions({ ...NO_FILTERS, ownerId: OWNER_ID });

    expect(
      options.map(({ value, href, current }) => [value, href, current]),
    ).toEqual([
      ["newest", `/admin?ownerId=${OWNER_ID}`, true],
      ["oldest", `/admin?ownerId=${OWNER_ID}&sort=oldest`, false],
      ["priceAsc", `/admin?ownerId=${OWNER_ID}&sort=priceAsc`, false],
      ["priceDesc", `/admin?ownerId=${OWNER_ID}&sort=priceDesc`, false],
    ]);
  });

  it("marks nothing as chosen when the ordering in the URL was refused", () => {
    expect(
      sortOptions({ ...NO_FILTERS, sort: "byTitle" }).some(
        (option) => option.current,
      ),
    ).toBe(false);
  });
});
