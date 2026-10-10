import { describe, expect, it } from "vitest";
import {
  nightlyPrice,
  pricedNights,
  stayTotal,
  type PricedListing,
} from "./pricing.js";

/** 14 October 2030 is a Monday, so the week below runs Monday to Sunday. */
const listing: PricedListing = {
  pricePerNight: 120.35,
  pricing: {
    weekdays: { fri: 150, sat: 160 },
    dates: [{ date: "2030-10-19", price: 400 }],
  },
};

describe("nightlyPrice", () => {
  it("charges the default on a day nothing else names", () => {
    expect(nightlyPrice(listing, "2030-10-14")).toBe(120.35);
  });

  it("charges the weekday's price on the day it falls on, counting the week from Monday", () => {
    expect(nightlyPrice(listing, "2030-10-18")).toBe(150);
    // Sunday ends the week — the day an off-by-one would move.
    expect(nightlyPrice(listing, "2030-10-20")).toBe(120.35);
  });

  it("puts a date's own price ahead of its weekday's", () => {
    // A Saturday, and Saturdays cost 160.
    expect(nightlyPrice(listing, "2030-10-19")).toBe(400);
  });
});

describe("pricedNights", () => {
  it("prices every night of the stay and not the check-out day", () => {
    expect(pricedNights(listing, "2030-10-17", "2030-10-20")).toEqual([
      { date: "2030-10-17", price: 120.35 },
      { date: "2030-10-18", price: 150 },
      { date: "2030-10-19", price: 400 },
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
  it("adds the nights up exact to the cent", () => {
    const nights = [120.35, 120.35, 120.35].map((price, n) => ({
      date: `2030-10-1${String(n)}`,
      price,
    }));

    expect(stayTotal(nights)).toBe(361.05);
  });
});
