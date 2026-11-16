import { describe, expect, it } from "vitest";
import { formatDate, formatMomentIn } from "./dates";

describe("formatMomentIn", () => {
  const moment = "2026-11-12T10:30:00.000Z";

  it("names a region's zone as it is stored", () => {
    expect(formatMomentIn(moment, "Europe/Berlin")).toBe(
      "12 Nov 2026, 11:30 Europe/Berlin",
    );
  });

  it("names an offset zone by the offset a person reads, its sign the right way round", () => {
    expect(formatMomentIn(moment, "Etc/GMT-3")).toBe(
      "12 Nov 2026, 13:30 UTC+3",
    );
    expect(formatMomentIn(moment, "Etc/GMT+10")).toBe(
      "12 Nov 2026, 00:30 UTC-10",
    );
  });
});

describe("formatDate", () => {
  it("is the day the moment falls on, on the clock it is given", () => {
    const evening = "2026-11-12T05:00:00.000Z";

    expect(formatDate(evening, "UTC")).toBe("12 Nov 2026");
    expect(formatDate(evening, "Pacific/Honolulu")).toBe("11 Nov 2026");
  });
});
