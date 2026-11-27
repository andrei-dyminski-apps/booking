import { describe, expect, it } from "vitest";
import { base64UrlToBytes, isAppleMobile } from "./pwa";

describe("base64UrlToBytes", () => {
  it("reads unpadded base64url, the alphabet a VAPID key is written in", () => {
    expect(Array.from(base64UrlToBytes("-_8"))).toEqual([0xfb, 0xff]);
    expect(Array.from(base64UrlToBytes("AQID"))).toEqual([1, 2, 3]);
  });
});

describe("isAppleMobile", () => {
  it("knows an iPhone, and an iPad that asks for the desktop site", () => {
    expect(
      isAppleMobile(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        5,
      ),
    ).toBe(true);
    expect(
      isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", 5),
    ).toBe(true);
  });

  it("does not take a Mac or another phone for one", () => {
    expect(
      isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", 0),
    ).toBe(false);
    expect(isAppleMobile("Mozilla/5.0 (Linux; Android 15; Pixel 7)", 5)).toBe(
      false,
    );
  });
});
