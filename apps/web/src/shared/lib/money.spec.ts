import { describe, expect, it } from "vitest";
import { cents } from "@repo/contracts";
import {
  centsFromInput,
  formatMoney,
  inputOfCents,
  nightsBreakdown,
} from "./money";

describe("centsFromInput", () => {
  it("shifts an amount written to the cent exactly, where a multiplication would not", () => {
    // 120.35 * 100 is 12034.999999999998 in binary floating point.
    expect(centsFromInput("120.35")).toBe(12_035);
    expect(centsFromInput("120.5")).toBe(12_050);
    expect(centsFromInput("120.")).toBe(12_000);
    expect(centsFromInput(" 120 ")).toBe(12_000);
    expect(centsFromInput("0.07")).toBe(7);
  });

  it("ignores zeros past the last digit of the fraction, and a missing whole part", () => {
    // 19.99 * 100 is 1998.9999999999998, and 0.07 * 100 is 7.000000000000001.
    expect(centsFromInput("19.990")).toBe(1_999);
    expect(centsFromInput("0.070")).toBe(7);
    expect(centsFromInput("120.5000")).toBe(12_050);
    expect(centsFromInput(".07")).toBe(7);
  });

  it("reads an empty box as no amount, for the contract to call missing", () => {
    expect(centsFromInput("")).toBeUndefined();
    expect(centsFromInput("   ")).toBeUndefined();
  });

  it("leaves what the contract refuses for it to refuse, rather than rounding it away", () => {
    expect(Number.isInteger(centsFromInput("120.505"))).toBe(false);
    expect(centsFromInput("-5")).toBe(-500);
    expect(centsFromInput("120.5050")).toBe(12_050.5);
    expect(centsFromInput("abc")).toBeNaN();
    expect(centsFromInput(".")).toBeNaN();
  });

  it("refuses digits past the cent however many there are, which a float would round away", () => {
    // Number("120.5000000000000001") is 120.5: multiplied, it would be a clean 12050.
    expect(Number.isInteger(centsFromInput("120.5000000000000001"))).toBe(
      false,
    );
    expect(Number.isInteger(centsFromInput("0.0000000000000001"))).toBe(false);
  });

  it("reads a whole part too long to count exactly as the largest exact count, not as a fraction", () => {
    expect(centsFromInput("99999999999999999")).toBe(Number.MAX_SAFE_INTEGER);
    expect(centsFromInput("-99999999999999999.5")).toBe(
      -Number.MAX_SAFE_INTEGER,
    );
  });

  it("reads only plain decimal notation, so nothing else becomes a price", () => {
    expect(centsFromInput("1e3")).toBeNaN();
    expect(centsFromInput("0x10")).toBeNaN();
    expect(centsFromInput("Infinity")).toBeNaN();
    expect(centsFromInput("1.2.3")).toBeNaN();
    expect(centsFromInput("+5")).toBe(500);
  });
});

describe("formatMoney and inputOfCents", () => {
  it("put cents back into the currency, the second decimal included", () => {
    expect(formatMoney(cents(12_050))).toBe("$120.50");
    expect(formatMoney(cents(99_999_999))).toBe("$999,999.99");
    expect(inputOfCents(cents(12_000))).toBe("120.00");
    expect(centsFromInput(inputOfCents(cents(12_035)))).toBe(12_035);
  });
});

describe("nightsBreakdown", () => {
  it("groups the nights by price in the order the prices first appear", () => {
    expect(
      nightsBreakdown([
        { date: "2030-10-17", priceCents: cents(12_000) },
        { date: "2030-10-18", priceCents: cents(15_000) },
        { date: "2030-10-19", priceCents: cents(12_000) },
      ]),
    ).toBe("2 nights × $120.00 + 1 night × $150.00");
  });
});
