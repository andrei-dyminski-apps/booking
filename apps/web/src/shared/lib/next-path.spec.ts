import { describe, expect, it } from "vitest";
import { toLocalPath } from "./next-path";

const FALLBACK = "/profile";

describe("toLocalPath", () => {
  it("keeps a path of this site", () => {
    expect(toLocalPath("/bookings", FALLBACK)).toBe("/bookings");
  });

  it("keeps the query and the fragment along with it", () => {
    expect(toLocalPath("/bookings?page=2#top", FALLBACK)).toBe(
      "/bookings?page=2#top",
    );
  });

  it.each([
    ["a protocol-relative URL a browser reads as absolute", "//evil.com"],
    ["the same with a backslash, which browsers normalise", "/\\evil.com"],
    ["a backslash after a slash anywhere in the pair", "/\\/evil.com"],
    ["an absolute URL", "https://evil.com/pwned"],
    ["a scheme with no host", "javascript:alert(1)"],
    ["a relative path, which the redirect would resolve elsewhere", "bookings"],
    ["an empty value", ""],
  ])("refuses %s", (_reason, value) => {
    expect(toLocalPath(value, FALLBACK)).toBe(FALLBACK);
  });

  it("refuses a repeated ?next=, which arrives as an array", () => {
    expect(toLocalPath(["/a", "/b"], FALLBACK)).toBe(FALLBACK);
  });

  it("falls back when the parameter is absent", () => {
    expect(toLocalPath(undefined, FALLBACK)).toBe(FALLBACK);
  });
});
