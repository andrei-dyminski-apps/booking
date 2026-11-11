import { describe, expect, it } from "vitest";
import { earlyCheckOut, mayEndEarly, unusedNightsRefund } from "./early-end.js";
import type { CancellationPolicy } from "./cancellation-policy.js";
import { cents } from "./money.js";
import type { PricedNight } from "./pricing.js";

/** Four nights, 14th to 18th, the weekend dearer. */
const nights: PricedNight[] = [
  { date: "2030-10-14", priceCents: cents(10_000) },
  { date: "2030-10-15", priceCents: cents(10_000) },
  { date: "2030-10-16", priceCents: cents(15_001) },
  { date: "2030-10-17", priceCents: cents(15_000) },
];

const stay = {
  status: "CONFIRMED" as const,
  from: "2030-10-14",
  to: "2030-10-18",
};

const money = (
  cancellationPolicy: CancellationPolicy,
  refundedAmountCents: number | null = null,
) => ({
  cancellationPolicy,
  amountCents: cents(50_001),
  refundedAmountCents:
    refundedAmountCents === null ? null : cents(refundedAmountCents),
});

describe("earlyCheckOut", () => {
  it("is the next day, across a month's end", () => {
    expect(earlyCheckOut("2030-10-31")).toBe("2030-11-01");
  });
});

describe("mayEndEarly", () => {
  it("is refused before check-in: that is a cancellation", () => {
    expect(mayEndEarly(stay, "2030-10-13")).toBe(false);
  });

  it("is allowed from the check-in day on", () => {
    expect(mayEndEarly(stay, "2030-10-14")).toBe(true);
    expect(mayEndEarly(stay, "2030-10-16")).toBe(true);
  });

  it("is refused on the last night: nothing is left after tonight", () => {
    expect(mayEndEarly(stay, "2030-10-17")).toBe(false);
    expect(mayEndEarly(stay, "2030-10-18")).toBe(false);
  });

  it("is refused for anything but a confirmed stay", () => {
    expect(mayEndEarly({ ...stay, status: "CANCELLED" }, "2030-10-15")).toBe(
      false,
    );
    expect(
      mayEndEarly({ ...stay, status: "PENDING_PAYMENT" }, "2030-10-15"),
    ).toBe(false);
  });

  it("is refused for a stay ended early already — it checks out tomorrow", () => {
    expect(mayEndEarly({ ...stay, to: "2030-10-16" }, "2030-10-15")).toBe(
      false,
    );
  });
});

describe("unusedNightsRefund", () => {
  it("uses tonight and gives back every night from tomorrow's on", () => {
    expect(unusedNightsRefund(money("FLEXIBLE"), nights, "2030-10-14")).toEqual(
      {
        checkOut: "2030-10-15",
        nights: 3,
        shareBps: 10_000,
        cents: 40_001,
        reduced: false,
      },
    );
  });

  it("on the night before the last, gives back the last night alone", () => {
    expect(unusedNightsRefund(money("FLEXIBLE"), nights, "2030-10-16")).toEqual(
      {
        checkOut: "2030-10-17",
        nights: 1,
        shareBps: 10_000,
        cents: 15_000,
        reduced: false,
      },
    );
  });

  it("takes the policy's share, rounded half up in the guest's favour", () => {
    // Half of 15001 + 15000 is 15000.5.
    expect(
      unusedNightsRefund(money("MODERATE"), nights, "2030-10-15").cents,
    ).toBe(15_001);
  });

  it("gives back nothing under a policy that keeps the unused nights", () => {
    for (const policy of ["LIMITED", "FIRM", "NON_REFUNDABLE"] as const) {
      expect(unusedNightsRefund(money(policy), nights, "2030-10-14")).toEqual({
        checkOut: "2030-10-15",
        nights: 3,
        shareBps: 0,
        cents: 0,
        reduced: false,
      });
    }
  });

  it("spreads an earlier refund over every night alike, by price", () => {
    // 40001 of 50001 unused; 45000 refunded leaves 5001: 40001 × 5001 / 50001 = 4000.82.
    expect(
      unusedNightsRefund(money("FLEXIBLE", 45_000), nights, "2030-10-14"),
    ).toMatchObject({ cents: 4_001, reduced: true });
    // 40001 × 40001 / 50001 = 32000.96 — the night used keeps paying its part.
    expect(
      unusedNightsRefund(money("FLEXIBLE", 10_000), nights, "2030-10-14"),
    ).toMatchObject({ cents: 32_001, reduced: true });
    expect(
      unusedNightsRefund(money("FLEXIBLE", 50_001), nights, "2030-10-14").cents,
    ).toBe(0);
  });

  it("rounds the policy's share of what is left once", () => {
    // 50% of 32000.96 is 16000.48: one rounding gives 16000, two would give 16001.
    expect(
      unusedNightsRefund(money("MODERATE", 10_000), nights, "2030-10-14"),
    ).toMatchObject({ cents: 16_000, reduced: true });
  });

  it("gives back the unused nights at the discount, not at their full prices", () => {
    // 5000 off the 50001 of nights: 45001 paid, so the 40001 unused hold 40001 × 45001 / 50001
    // = 36000.98 — a share of their full prices would hand back money nobody paid.
    const discounted = (refundedAmountCents: number | null = null) => ({
      ...money("FLEXIBLE", refundedAmountCents),
      amountCents: cents(45_001),
    });

    expect(
      unusedNightsRefund(discounted(), nights, "2030-10-14"),
    ).toMatchObject({ cents: 36_001, reduced: false });
    // An earlier refund on top of the discount reduces it, and only that does: 40001 left
    // of the 45001 paid is 40001 × 40001 / 50001 = 32000.96.
    expect(
      unusedNightsRefund(discounted(5_000), nights, "2030-10-14"),
    ).toMatchObject({ cents: 32_001, reduced: true });
    // A partial share is rounded once: 50% of 36000.98 is 18000.49.
    expect(
      unusedNightsRefund(
        { ...discounted(), cancellationPolicy: "MODERATE" },
        nights,
        "2030-10-14",
      ),
    ).toMatchObject({ cents: 18_000, reduced: false });
  });

  it("stays clear of the float's limit at the largest charge", () => {
    // 50000000 × 66666666 / 99999999 = 33333333.33, past 2^53 before the division.
    const priced = [
      { date: "2030-10-14", priceCents: cents(49_999_999) },
      { date: "2030-10-15", priceCents: cents(50_000_000) },
    ];

    expect(
      unusedNightsRefund(
        {
          cancellationPolicy: "FLEXIBLE",
          amountCents: cents(99_999_999),
          refundedAmountCents: cents(33_333_333),
        },
        priced,
        "2030-10-14",
      ).cents,
    ).toBe(33_333_333);
  });
});
