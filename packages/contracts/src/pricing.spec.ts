import { describe, expect, it } from "vitest";
import {
  chargeRefusal,
  nightlyPrice,
  pricedNights,
  quoteStay,
  STAY_TOO_CHEAP,
  STAY_TOO_EXPENSIVE,
  stayTotal,
  type PricedListing,
} from "./pricing.js";
import { MAX_NON_REFUNDABLE_DISCOUNT_BPS } from "./listing.js";
import { cents, MAX_CHARGE, MIN_CHARGE } from "./money.js";

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

describe("quoteStay", () => {
  it("charges the nights' total at the standard rate", () => {
    expect(quoteStay(listing, "2030-10-17", "2030-10-20")).toEqual({
      nights: [
        { date: "2030-10-17", priceCents: 12_035 },
        { date: "2030-10-18", priceCents: 15_000 },
        { date: "2030-10-19", priceCents: 40_000 },
      ],
      discountCents: 0,
      amountCents: 67_035,
    });
  });

  it("takes the discount off the total and leaves the nights at their own prices", () => {
    const quote = quoteStay(listing, "2030-10-17", "2030-10-20", 1_000);

    expect(quote.nights.map(({ priceCents }) => priceCents)).toEqual([
      12_035, 15_000, 40_000,
    ]);
    expect(quote.discountCents).toBe(6_704);
    expect(quote.amountCents).toBe(67_035 - 6_704);
  });

  it("rounds the discount once, half up in the guest's favour", () => {
    // 15% of 12_035 is 1_805.25 a night: rounded per night three times it would be 5_415,
    // rounded once off the 36_105 total it is 5_415.75 → 5_416.
    const quote = quoteStay(listing, "2030-10-14", "2030-10-17", 1_500);

    expect(quote.discountCents).toBe(5_416);
    expect(quote.amountCents).toBe(30_689);

    // An exact half cent goes to the guest: 5% of 10 is 0.5.
    const cheap = { pricePerNightCents: cents(10), pricing: listing.pricing };

    expect(quoteStay(cheap, "2030-10-14", "2030-10-15", 500)).toMatchObject({
      discountCents: 1,
      amountCents: 9,
    });
  });

  it("gives the guest the odd cent at the deepest discount, and never more", () => {
    // Half of 12_001 is 6_000.5: the discount takes the odd cent, one past what is left —
    // the slack `bookings_discount_within_amount` allows and nothing beyond it.
    const odd = { pricePerNightCents: cents(12_001), pricing: listing.pricing };

    const deepest = quoteStay(
      odd,
      "2030-10-14",
      "2030-10-15",
      MAX_NON_REFUNDABLE_DISCOUNT_BPS,
    );

    expect(deepest).toMatchObject({ discountCents: 6_001, amountCents: 6_000 });

    for (const price of [1, 99, 12_000, 12_035, 99_999]) {
      const { discountCents, amountCents } = quoteStay(
        { pricePerNightCents: cents(price), pricing: listing.pricing },
        "2030-10-14",
        "2030-10-15",
        MAX_NON_REFUNDABLE_DISCOUNT_BPS,
      );

      expect(discountCents).toBeLessThanOrEqual(amountCents + 1);
    }
  });

  it("quotes nothing for a range that is not one", () => {
    expect(quoteStay(listing, "2030-10-17", "2030-10-17", 1_000)).toEqual({
      nights: [],
      discountCents: 0,
      amountCents: 0,
    });
  });
});

describe("chargeRefusal", () => {
  it("takes both bounds of one payment and refuses past either", () => {
    expect(chargeRefusal(MIN_CHARGE)).toBeNull();
    expect(chargeRefusal(MAX_CHARGE)).toBeNull();
    expect(chargeRefusal(cents(MIN_CHARGE - 1))).toBe(STAY_TOO_CHEAP);
    expect(chargeRefusal(cents(MAX_CHARGE + 1))).toBe(STAY_TOO_EXPENSIVE);
  });

  it("judges a stay by what it charges after the discount", () => {
    // 50 cents is the floor itself; 1% off rounds up to a cent and leaves 49.
    const atTheFloor = {
      pricePerNightCents: cents(50),
      pricing: { weekdays: {}, dates: [] },
    };
    const standard = quoteStay(atTheFloor, "2030-10-14", "2030-10-15");
    const discounted = quoteStay(atTheFloor, "2030-10-14", "2030-10-15", 100);

    expect(chargeRefusal(standard.amountCents)).toBeNull();
    expect(discounted.amountCents).toBe(49);
    expect(chargeRefusal(discounted.amountCents)).toBe(STAY_TOO_CHEAP);
  });
});
