import { describe, expect, it } from "vitest";
import {
  activeFilters,
  bookingsHref,
  clearedFiltersHref,
  listingStaysHref,
  readBookingsSearch,
  sortOptions,
} from "./bookings-search";

const LISTING_ID = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";
const GUEST_ID = "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f50";

const NO_FILTERS = {
  status: "",
  listingId: "",
  guestId: "",
  from: "",
  to: "",
  sort: "",
};

describe("readBookingsSearch", () => {
  it("asks the unfiltered question when the URL carries nothing", () => {
    const { query, errors, values } = readBookingsSearch({});

    expect(query).toEqual({ limit: 20, sort: "newest" });
    expect(errors).toEqual({});
    expect(values).toEqual(NO_FILTERS);
  });

  it("reads an empty box as an absent filter rather than as an empty string", () => {
    // What a GET form submits for a filter nobody filled in.
    const { query } = readBookingsSearch({
      status: "",
      listingId: "",
      from: "",
      to: "",
    });

    expect(query).toEqual({ limit: 20, sort: "newest" });
  });

  it("carries the filters the contract takes", () => {
    const { query } = readBookingsSearch({
      status: "CANCELLED",
      listingId: LISTING_ID,
      guestId: GUEST_ID,
      from: "2030-01-02",
      to: "2030-01-09",
    });

    expect(query).toEqual({
      limit: 20,
      sort: "newest",
      status: "CANCELLED",
      listingId: LISTING_ID,
      guestId: GUEST_ID,
      from: "2030-01-02",
      to: "2030-01-09",
    });
  });

  it("keeps half a window out of the API and reports it under the second box", () => {
    const { query, errors, values } = readBookingsSearch({
      from: "2030-01-02",
    });

    expect(query).toBeNull();
    expect(errors.to).toHaveLength(1);
    // The box keeps what was typed: the message is about the one next to it.
    expect(values.from).toBe("2030-01-02");
  });

  it("refuses an end that is not after the start", () => {
    const { query, errors } = readBookingsSearch({
      from: "2030-01-02",
      to: "2030-01-02",
    });

    expect(query).toBeNull();
    expect(errors.to).toHaveLength(1);
  });

  it("refuses a status nobody has, and an id that is not one", () => {
    expect(readBookingsSearch({ status: "PAID" }).errors.status).toHaveLength(
      1,
    );
    expect(
      readBookingsSearch({ listingId: "not-a-uuid" }).errors.listingId,
    ).toHaveLength(1);
    expect(readBookingsSearch({ guestId: "42" }).query).toBeNull();
  });

  it("drops a parameter the URL repeats instead of guessing which one was meant", () => {
    const { query, values } = readBookingsSearch({
      status: ["CONFIRMED", "CANCELLED"],
    });

    expect(query).toEqual({ limit: 20, sort: "newest" });
    expect(values.status).toBe("");
  });

  it("carries the cursor through untouched — only the API can read it", () => {
    const { query } = readBookingsSearch({ cursor: "b3BhcXVl" });

    expect(query).toEqual({ limit: 20, sort: "newest", cursor: "b3BhcXVl" });
  });

  it("reads the ordering the URL asks for, and refuses one nobody offers", () => {
    expect(readBookingsSearch({ sort: "checkInAsc" }).query).toEqual({
      limit: 20,
      sort: "checkInAsc",
    });

    // It is one of four names or it is nothing: the API indexes exactly those pairs, so
    // quietly falling back to the newest would answer a different question than the link.
    const refused = readBookingsSearch({ sort: "soonest" });

    expect(refused.query).toBeNull();
    expect(refused.errors.sort).toHaveLength(1);
  });
});

describe("readBookingsSearch, the address it belongs at", () => {
  it("leaves an address that is already the one this slice writes", () => {
    expect(readBookingsSearch({}).canonical).toBeNull();
    expect(
      readBookingsSearch({ status: "CONFIRMED", sort: "checkInAsc" }).canonical,
    ).toBeNull();
    expect(
      readBookingsSearch({ status: "CONFIRMED", cursor: "b3BhcXVl" }).canonical,
    ).toBeNull();
  });

  it("drops the empty boxes a GET form submits beside the one that was filled in", () => {
    const { canonical } = readBookingsSearch({
      status: "CONFIRMED",
      listingId: "",
      guestId: "",
      from: "",
      to: "",
      sort: "",
    });

    expect(canonical).toBe("/bookings?status=CONFIRMED");
  });

  it("writes the parameters in the order every link of this slice writes them", () => {
    // Otherwise the same search is two addresses again, one of them written by the form
    // and the other by a chip.
    expect(
      readBookingsSearch({ sort: "checkInAsc", status: "CONFIRMED" }).canonical,
    ).toBe("/bookings?status=CONFIRMED&sort=checkInAsc");
  });

  it("drops what this screen does not take, and a parameter the URL repeats", () => {
    expect(
      readBookingsSearch({ status: "CONFIRMED", ref: "email" }).canonical,
    ).toBe("/bookings?status=CONFIRMED");
    expect(
      readBookingsSearch({ status: ["CONFIRMED", "CANCELLED"] }).canonical,
    ).toBe("/bookings");
  });

  it("canonicalises a search the contract refuses as well", () => {
    // The boxes and the message about them are what this address is for, so it is the one
    // the mistake is corrected at.
    const { query, canonical } = readBookingsSearch({
      sort: "soonest",
      status: "",
    });

    expect(query).toBeNull();
    expect(canonical).toBe("/bookings?sort=soonest");
  });

  it("round-trips: the address it names is one it would leave alone", () => {
    // A redirect onto an address that redirects again is a loop, so this is the property
    // that matters rather than any single link above.
    const canonical = readBookingsSearch({
      status: " CONFIRMED ",
      listingId: LISTING_ID,
      from: "2030-01-02",
      to: "2030-01-09",
      guestId: "",
      sort: "checkInDesc",
      cursor: "b3BhcXVl",
    }).canonical;

    expect(canonical).toBe(
      `/bookings?status=CONFIRMED&listingId=${LISTING_ID}&from=2030-01-02&to=2030-01-09&sort=checkInDesc&cursor=b3BhcXVl`,
    );

    const params = Object.fromEntries(
      new URL(canonical ?? "", "https://example.test").searchParams,
    );

    expect(readBookingsSearch(params).canonical).toBeNull();
  });

  it("is a fixed point for every link this slice writes", () => {
    // The three kinds of link on the screen — a chip, an ordering and the next page — all
    // land at an address the page has to serve rather than redirect again.
    const values = {
      status: "CONFIRMED",
      listingId: LISTING_ID,
      guestId: GUEST_ID,
      from: "2030-01-02",
      to: "2030-01-09",
      sort: "checkInAsc",
    };

    const links = [
      ...activeFilters(values).map((filter) => filter.href),
      ...sortOptions(values).map((option) => option.href),
      clearedFiltersHref(values),
      listingStaysHref(LISTING_ID),
      bookingsHref(values, "b3BhcXVl"),
    ];

    for (const href of links) {
      const params = Object.fromEntries(
        new URL(href, "https://example.test").searchParams,
      );

      expect(readBookingsSearch(params).canonical).toBeNull();
    }
  });
});

describe("sortOptions", () => {
  it("offers every ordering the contract has, and marks the default when the URL is silent", () => {
    const options = sortOptions(NO_FILTERS);

    expect(options.map((option) => option.value)).toEqual([
      "newest",
      "oldest",
      "checkInAsc",
      "checkInDesc",
    ]);
    expect(options.filter((option) => option.current)).toHaveLength(1);
    expect(options[0]?.current).toBe(true);
  });

  it("keeps the default out of the URL and spells the other three out", () => {
    const [newest, , checkInAsc] = sortOptions(NO_FILTERS);

    expect(newest?.href).toBe("/bookings");
    expect(checkInAsc?.href).toBe("/bookings?sort=checkInAsc");
  });

  it("keeps the filters and drops the cursor: a cursor names a place in one ordering", () => {
    const [, , , checkInDesc] = sortOptions({
      ...NO_FILTERS,
      status: "CONFIRMED",
      sort: "checkInAsc",
    });

    expect(checkInDesc?.href).toBe(
      "/bookings?status=CONFIRMED&sort=checkInDesc",
    );
  });

  it("marks none of them current when the URL carries an ordering that is not one", () => {
    const options = sortOptions({ ...NO_FILTERS, sort: "soonest" });

    expect(options.every((option) => !option.current)).toBe(true);
  });
});

describe("bookingsHref", () => {
  it("is the bare route when nothing is filtered", () => {
    expect(bookingsHref(NO_FILTERS)).toBe("/bookings");
  });

  it("adds the cursor of the next page beside the filters", () => {
    expect(bookingsHref({ ...NO_FILTERS, status: "EXPIRED" }, "b3BhcXVl")).toBe(
      "/bookings?status=EXPIRED&cursor=b3BhcXVl",
    );
  });

  it("round-trips: the link it writes parses back to the same question", () => {
    const values = {
      status: "CONFIRMED",
      listingId: LISTING_ID,
      guestId: GUEST_ID,
      from: "2030-01-02",
      to: "2030-01-09",
      sort: "checkInAsc",
    };
    const params = Object.fromEntries(
      new URL(bookingsHref(values), "https://example.test").searchParams,
    );

    expect(readBookingsSearch(params).values).toEqual(values);
  });
});

describe("clearedFiltersHref and listingStaysHref", () => {
  it("takes every filter off and leaves the ordering where it was", () => {
    expect(
      clearedFiltersHref({
        ...NO_FILTERS,
        status: "CONFIRMED",
        sort: "checkInAsc",
      }),
    ).toBe("/bookings?sort=checkInAsc");
  });

  it("starts a fresh search from a card, filtered by that listing alone", () => {
    expect(listingStaysHref(LISTING_ID)).toBe(
      `/bookings?listingId=${LISTING_ID}`,
    );
  });
});

describe("activeFilters", () => {
  it("has nothing to show for an unfiltered search", () => {
    expect(activeFilters(NO_FILTERS)).toEqual([]);
  });

  it("names a window as one chip, and takes both halves off together", () => {
    // Half a window is a search the contract refuses, so removing one half alone would
    // write a link the API cannot answer.
    const [dates, ...rest] = activeFilters({
      ...NO_FILTERS,
      from: "2030-01-02",
      to: "2030-01-09",
    });

    expect(rest).toEqual([]);
    expect(dates?.label).toBe("2 Jan 2030 → 9 Jan 2030");
    expect(dates?.href).toBe("/bookings");
  });

  it("says which half of a window is missing rather than dropping the chip", () => {
    const [dates] = activeFilters({ ...NO_FILTERS, from: "2030-01-02" });

    expect(dates?.label).toBe("2 Jan 2030 → any date");
  });

  it("calls a status what the badge on the row calls it", () => {
    const [status] = activeFilters({
      ...NO_FILTERS,
      status: "PENDING_PAYMENT",
    });

    expect(status?.label).toBe("On hold");
    expect(status?.href).toBe("/bookings");
  });

  it("names a listing by its title where the page resolved one, and by its id otherwise", () => {
    const values = { ...NO_FILTERS, listingId: LISTING_ID };

    expect(
      activeFilters(values, { listing: "Loft above the harbour" })[0],
    ).toMatchObject({ label: "Loft above the harbour" });
    expect(activeFilters(values)[0]).toMatchObject({
      label: "Listing 6d0f2c1e…",
    });
  });

  it("names a guest by their address where the page resolved one, and by their id otherwise", () => {
    const values = { ...NO_FILTERS, guestId: LISTING_ID };

    expect(
      activeFilters(values, { guest: "guest@example.com" })[0],
    ).toMatchObject({ label: "guest@example.com" });
    expect(activeFilters(values)[0]).toMatchObject({
      label: "Guest 6d0f2c1e…",
    });
  });

  it("carries a value the contract refuses as it was typed", () => {
    // It arrives out of a URL like every other filter: the parse has already refused the
    // search, and the chip is what lets a visitor take the refused filter off again.
    const [status] = activeFilters({ ...NO_FILTERS, status: "PAID" });

    expect(status?.label).toBe("PAID");
    expect(status?.href).toBe("/bookings");
  });

  it("carries the ordering along and removes one filter at a time", () => {
    const filters = activeFilters({
      ...NO_FILTERS,
      status: "CONFIRMED",
      listingId: LISTING_ID,
      guestId: GUEST_ID,
      from: "2030-01-02",
      to: "2030-01-09",
      sort: "checkInAsc",
    });

    expect(filters.map((filter) => filter.key)).toEqual([
      "status",
      "listingId",
      "guestId",
      "dates",
    ]);
    expect(filters[0]?.href).toBe(
      `/bookings?listingId=${LISTING_ID}&guestId=${GUEST_ID}&from=2030-01-02&to=2030-01-09&sort=checkInAsc`,
    );
  });
});
