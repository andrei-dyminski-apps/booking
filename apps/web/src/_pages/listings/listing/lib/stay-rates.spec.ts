import { describe, expect, it } from "vitest";
import {
  BookingRate,
  cents,
  STAY_TOO_CHEAP,
  STAY_TOO_EXPENSIVE,
  type PricedListing,
} from "@repo/contracts";
import { stayCharge, stayRates, type StayRates } from "./stay-rates";

/** 14 October 2030 is a Monday; no weekday or date is priced on its own. */
const at = (pricePerNightCents: number): PricedListing => ({
  pricePerNightCents: cents(pricePerNightCents),
  pricing: { weekdays: {}, dates: [] },
});

const quoted = (
  pricePerNightCents: number,
  discountBps: number | null,
  to = "2030-10-15",
): StayRates => {
  const rates = stayRates(
    at(pricePerNightCents),
    discountBps,
    "2030-10-14",
    to,
  );

  if (rates === null) throw new Error("The dates were expected to be quoted");

  return rates;
};

describe("stayCharge", () => {
  it("refuses a discount that takes the stay below the floor and points to the standard rate", () => {
    // 50 cents is the floor itself; 1% off it rounds up to a cent and leaves 49.
    const charge = stayCharge(
      quoted(50, 100),
      BookingRate.NON_REFUNDABLE,
      false,
    );

    expect(charge.quote.amountCents).toBe(49);
    expect(charge.refusal).toBe(STAY_TOO_CHEAP);
    expect(charge.instead).toBe(BookingRate.STANDARD);
  });

  it("refuses a standard total above the ceiling and points to the discount that brings it under", () => {
    // Two nights at 50_000_000 are a cent past the ceiling; 1% off leaves 99_000_000.
    const charge = stayCharge(
      quoted(50_000_000, 100, "2030-10-16"),
      BookingRate.STANDARD,
      false,
    );

    expect(charge.refusal).toBe(STAY_TOO_EXPENSIVE);
    expect(charge.instead).toBe(BookingRate.NON_REFUNDABLE);
  });

  it("refuses nothing while the booked rate fits", () => {
    const charge = stayCharge(
      quoted(10_000, 1_000),
      BookingRate.NON_REFUNDABLE,
      false,
    );

    expect(charge.quote.amountCents).toBe(9_000);
    expect(charge.refusal).toBeNull();
    expect(charge.instead).toBeNull();
    expect(
      stayCharge(quoted(50, 100), BookingRate.STANDARD, false).refusal,
    ).toBeNull();
  });

  it("points nowhere when neither rate fits, or the listing offers one", () => {
    const neither = stayCharge(quoted(30, 100), BookingRate.STANDARD, false);
    const single = stayCharge(quoted(30, null), BookingRate.STANDARD, false);

    expect(neither.refusal).toBe(STAY_TOO_CHEAP);
    expect(neither.instead).toBeNull();
    expect(single.refusal).toBe(STAY_TOO_CHEAP);
    expect(single.instead).toBeNull();
  });

  it("refuses nothing for dates the waitlist takes, which charge nothing", () => {
    const charge = stayCharge(quoted(30, null), BookingRate.STANDARD, true);

    expect(charge.refusal).toBeNull();
    expect(charge.instead).toBeNull();
  });
});

describe("stayRates", () => {
  it("answers the same call once and a changed one afresh", () => {
    const prices = at(10_000);
    const first = stayRates(prices, 1_000, "2030-10-14", "2030-10-16");

    expect(stayRates(prices, 1_000, "2030-10-14", "2030-10-16")).toBe(first);
    expect(
      stayRates(prices, 2_000, "2030-10-14", "2030-10-16")?.nonRefundable
        ?.amountCents,
    ).toBe(16_000);
    expect(stayRates(prices, 1_000, "2030-10-14", "2030-10-17")).not.toBe(
      first,
    );
    expect(
      stayRates(at(20_000), 1_000, "2030-10-14", "2030-10-16")?.standard
        .amountCents,
    ).toBe(40_000);
  });
});
