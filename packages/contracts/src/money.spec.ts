import { describe, expect, it } from "vitest";
import { cents, centsSchema, shareOf, subtractCents } from "./money.js";

describe("cents", () => {
  it("refuses a fraction rather than rounding it", () => {
    expect(() => cents(120.5)).toThrow(RangeError);
    expect(cents(12_050)).toBe(12_050);
  });

  it("refuses a negative amount, as the schema does", () => {
    expect(() => cents(-1)).toThrow(RangeError);
    expect(() => subtractCents(cents(100), cents(101))).toThrow(RangeError);
    expect(cents(0)).toBe(0);
  });
});

describe("centsSchema", () => {
  it("reads a whole, non-negative number of cents and nothing else", () => {
    expect(centsSchema.safeParse(0).success).toBe(true);
    expect(centsSchema.safeParse(12_050).success).toBe(true);
    expect(centsSchema.safeParse(120.5).success).toBe(false);
    expect(centsSchema.safeParse(-1).success).toBe(false);
  });
});

describe("shareOf", () => {
  it("takes basis points of an amount, rounding half up", () => {
    expect(shareOf(cents(10_000), 1_500)).toBe(1_500);
    // 15% of 1 cent is 0.15, of 10 cents 1.5.
    expect(shareOf(cents(1), 1_500)).toBe(0);
    expect(shareOf(cents(10), 1_500)).toBe(2);
  });
});
