import { describe, expect, it } from "vitest";
import {
  nightlyPrice,
  pricedNights,
  stayTotal,
  type PricedListing,
} from "./pricing.js";
import { cents } from "./money.js";

/** 14 October 2030 is a Monday, so the week below runs Monday to Sunday. */
const listing: PricedListing = {
  pricePerNightCents: cents(12_035),
  pricing: {
    weekdays: { fri: cents(15_000), sat: cents(16_000) },
    dates: [{ date: "2030-10-19", priceCents: cents(40_000) }],
  },
};

describe("nightlyPrice", () => {
  it("charges the default on a day nothing else names", () => {
    expect(nightlyPrice(listing, "2030-10-14")).toBe(12_035);
  });

  it("charges the weekday's price on the day it falls on, counting the week from Monday", () => {
    expect(nightlyPrice(listing, "2030-10-18")).toBe(15_000);
    // Sunday ends the week — the day an off-by-one would move.
    expect(nightlyPrice(listing, "2030-10-20")).toBe(12_035);
  });

  it("puts a date's own price ahead of its weekday's", () => {
    // A Saturday, and Saturdays cost 16_000.
    expect(nightlyPrice(listing, "2030-10-19")).toBe(40_000);
  });
});

describe("pricedNights", () => {
  it("prices every night of the stay and not the check-out day", () => {
    expect(pricedNights(listing, "2030-10-17", "2030-10-20")).toEqual([
      { date: "2030-10-17", priceCents: 12_035 },
      { date: "2030-10-18", priceCents: 15_000 },
      { date: "2030-10-19", priceCents: 40_000 },
    ]);
  });

  it("answers no nights for a range that is not one", () => {
    expect(pricedNights(listing, "2030-10-17", "2030-10-17")).toEqual([]);
    expect(pricedNights(listing, "2030-10-17", "2030-10-10")).toEqual([]);
  });

  it("walks across a month and a year end", () => {
    expect(
      pricedNights(listing, "2030-12-30", "2031-01-02").map(({ date }) => date),
    ).toEqual(["2030-12-30", "2030-12-31", "2031-01-01"]);
  });
});

describe("stayTotal", () => {
  it("adds the nights up in cents", () => {
    const nights = [12_035, 12_035, 12_035].map((price, n) => ({
      date: `2030-10-1${String(n)}`,
      priceCents: cents(price),
    }));

    expect(stayTotal(nights)).toBe(36_105);
  });
});
