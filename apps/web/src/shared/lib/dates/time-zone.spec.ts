import { describe, expect, it } from "vitest";
import { readerTimeZoneOf } from "./time-zone";

describe("readerTimeZoneOf", () => {
  it("is UTC before the browser has written the cookie", () => {
    expect(readerTimeZoneOf(undefined)).toBe("UTC");
  });

  it("keeps a zone the runtime knows, under its name of today", () => {
    expect(readerTimeZoneOf("Europe/Berlin")).toBe("Europe/Berlin");
    expect(readerTimeZoneOf("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(readerTimeZoneOf("Etc/UTC")).toBe("UTC");
  });

  it("keeps a fixed offset spelled as a region, which a reader's clock may be on", () => {
    expect(readerTimeZoneOf("Etc/GMT-3")).toBe("Etc/GMT-3");
    expect(readerTimeZoneOf("Etc/GMT+10")).toBe("Etc/GMT+10");
  });

  it("falls back to UTC for a raw offset, an unknown name or anything else", () => {
    expect(readerTimeZoneOf("+05:00")).toBe("UTC");
    expect(readerTimeZoneOf("Etc/GMT-99")).toBe("UTC");
    expect(readerTimeZoneOf("Mars/Olympus_Mons")).toBe("UTC");
    expect(readerTimeZoneOf("")).toBe("UTC");
    expect(readerTimeZoneOf("<script>")).toBe("UTC");
  });
});
