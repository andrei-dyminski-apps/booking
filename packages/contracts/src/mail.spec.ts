import { describe, expect, it } from "vitest";
import { isExampleMailAddress } from "./mail.js";

describe("isExampleMailAddress", () => {
  it("matches the example domains whatever the case", () => {
    expect(isExampleMailAddress("guest@example.com")).toBe(true);
    expect(isExampleMailAddress("Ines@Example.NET")).toBe(true);
    expect(isExampleMailAddress("a@example.org")).toBe(true);
  });

  it("leaves real and look-alike domains alone", () => {
    expect(isExampleMailAddress("me@staydesk.test")).toBe(false);
    expect(isExampleMailAddress("me@example.com.evil.io")).toBe(false);
    expect(isExampleMailAddress("me@notexample.com")).toBe(false);
  });
});
