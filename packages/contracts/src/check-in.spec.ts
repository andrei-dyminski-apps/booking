import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalTimeZone,
  checkInDayEnd,
  checkInInstant,
  isCheckInDayPast,
  runtimeTimeZone,
  timeZoneSchema,
} from "./check-in.js";

describe("timeZoneSchema", () => {
  it("keeps a region's name as Intl spells it", () => {
    expect(timeZoneSchema.parse("Europe/Berlin")).toBe("Europe/Berlin");
    expect(timeZoneSchema.parse("UTC")).toBe("UTC");
  });

  it("stores a name typed in another case or as an alias the way Intl spells it", () => {
    expect(timeZoneSchema.parse("europe/berlin")).toBe("Europe/Berlin");
    expect(timeZoneSchema.parse(" US/Eastern ")).toBe("America/New_York");
    expect(timeZoneSchema.parse("Etc/UTC")).toBe("UTC");
  });

  it("stores a zone IANA renamed under its name of today, whichever name was typed", () => {
    for (const [typed, stored] of [
      ["Asia/Kolkata", "Asia/Kolkata"],
      ["Asia/Calcutta", "Asia/Kolkata"],
      ["europe/kyiv", "Europe/Kyiv"],
      ["America/Argentina/Buenos_Aires", "America/Argentina/Buenos_Aires"],
    ]) {
      expect(timeZoneSchema.parse(typed)).toBe(stored);
    }
  });

  it("keeps a country's zone of its own rather than the one it follows", () => {
    expect(timeZoneSchema.parse("Europe/Bratislava")).toBe("Europe/Bratislava");
  });

  it("refuses an offset, spelled as one, as an Etc/GMT name or as an abbreviation Intl resolves to a region", () => {
    for (const offset of [
      "+05:00",
      "Etc/GMT+5",
      "Etc/GMT-14",
      "EST",
      "CET",
      "MST",
      "GMT",
    ]) {
      expect(timeZoneSchema.safeParse(offset).success).toBe(false);
    }
  });

  it("refuses a name nobody knows, and nothing at all", () => {
    for (const name of ["Mars/Olympus_Mons", "", "  "]) {
      expect(timeZoneSchema.safeParse(name).success).toBe(false);
    }
  });
});

describe("isCheckInDayPast", () => {
  // 20:00 UTC on 12 November: 13 November in Adelaide, still the 12th in Honolulu.
  const now = new Date("2026-11-12T20:00:00Z");

  it("refuses a day that is still today in UTC once it is over where the listing is", () => {
    const adelaide = { timeZone: "Australia/Adelaide" };

    expect(isCheckInDayPast(adelaide, "2026-11-12", now)).toBe(true);
    expect(isCheckInDayPast(adelaide, "2026-11-13", now)).toBe(false);
  });

  it("takes tonight where the listing is, though UTC has moved on to tomorrow", () => {
    const honolulu = { timeZone: "Pacific/Honolulu" };
    const late = new Date("2026-11-13T08:00:00Z");

    expect(isCheckInDayPast(honolulu, "2026-11-12", late)).toBe(false);
    expect(isCheckInDayPast(honolulu, "2026-11-11", late)).toBe(true);
  });
});

describe("checkInDayEnd", () => {
  it("is the listing's next midnight, the moment isCheckInDayPast turns true at", () => {
    const adelaide = { timeZone: "Australia/Adelaide" };
    const end = checkInDayEnd(adelaide, "2026-11-12");

    expect(end.toISOString()).toBe("2026-11-12T13:30:00.000Z");
    expect(
      isCheckInDayPast(adelaide, "2026-11-12", new Date(end.getTime() - 1)),
    ).toBe(false);
    expect(isCheckInDayPast(adelaide, "2026-11-12", end)).toBe(true);
  });

  it("ends a day on whatever moment the next one begins with, when midnight is skipped", () => {
    // Chile moves to summer time at midnight: 6 September 2026 begins at 01:00 there.
    expect(
      checkInDayEnd(
        { timeZone: "America/Santiago" },
        "2026-09-05",
      ).toISOString(),
    ).toBe("2026-09-06T04:00:00.000Z");
  });
});

describe("runtimeTimeZone", () => {
  const RealDateTimeFormat = Intl.DateTimeFormat;

  /** A runtime whose zone data predates `zone`'s rename: it knows the zone by its old name only. */
  function withoutZone(zone: string): void {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ) {
      if (options?.timeZone?.toLowerCase() === zone.toLowerCase()) {
        throw new RangeError(`Invalid time zone specified: ${zone}`);
      }

      return new RealDateTimeFormat(locales, options);
    } as typeof Intl.DateTimeFormat);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is the stored name itself where the runtime knows it", () => {
    expect(runtimeTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
  });

  it("converts by the older name IANA keeps as a link where the runtime predates the rename", () => {
    withoutZone("Pacific/Kanton");

    expect(runtimeTimeZone("Pacific/Kanton")).toBe("Pacific/Enderbury");
    // Kanton is UTC+13 all year: 15:00 there is 02:00 UTC.
    expect(
      checkInInstant({
        from: "2026-11-20",
        timeZone: "Pacific/Kanton",
        checkInTime: "15:00",
      }).toISOString(),
    ).toBe("2026-11-20T02:00:00.000Z");
  });

  it("lets such a runtime check a form whose zone it knows only by the older name", () => {
    withoutZone("America/Nuuk");

    expect(canonicalTimeZone("America/Nuuk")).toBe("America/Nuuk");
  });

  it("is null for a zone newer than the runtime's data, and a rule refuses it in words", () => {
    expect(runtimeTimeZone("Mars/Olympus_Mons")).toBeNull();
    expect(() =>
      checkInInstant({
        from: "2026-11-20",
        timeZone: "Mars/Olympus_Mons",
        checkInTime: "15:00",
      }),
    ).toThrow(RangeError);
  });
});
