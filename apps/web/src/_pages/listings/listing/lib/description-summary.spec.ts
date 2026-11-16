import { describe, expect, it } from "vitest";
import {
  charactersOf,
  descriptionSummary,
  SUMMARY_LENGTH,
} from "./description-summary";

const lengthOf = (text: string) => charactersOf(text).length;

describe("descriptionSummary", () => {
  it("leaves a description that fits as it is", () => {
    expect(descriptionSummary("A bright loft by the river.")).toBe(
      "A bright loft by the river.",
    );
  });

  it("keeps one exactly at the limit whole", () => {
    const text = "a".repeat(SUMMARY_LENGTH);

    expect(descriptionSummary(text)).toBe(text);
  });

  it("runs line breaks and repeated spaces together", () => {
    expect(descriptionSummary("  Two rooms.\n\nA garden\t and a view.  ")).toBe(
      "Two rooms. A garden and a view.",
    );
  });

  it("cuts a longer one at the last word, the ellipsis within the limit", () => {
    const summary = descriptionSummary("word ".repeat(60));

    expect(summary.endsWith("word…")).toBe(true);
    expect(lengthOf(summary)).toBeLessThanOrEqual(SUMMARY_LENGTH);
  });

  it("cuts a single word with nowhere to break inside it", () => {
    const summary = descriptionSummary("a".repeat(SUMMARY_LENGTH + 10));

    expect(summary).toBe(`${"a".repeat(SUMMARY_LENGTH - 1)}…`);
  });

  it("never splits a character outside the basic plane in half", () => {
    const summary = descriptionSummary("🏠".repeat(SUMMARY_LENGTH + 10));

    expect(summary).toBe(`${"🏠".repeat(SUMMARY_LENGTH - 1)}…`);
  });

  it("keeps a word that ends exactly where the room does", () => {
    const fits = `${"a".repeat(SUMMARY_LENGTH - 10)} ${"b".repeat(8)}`;

    expect(descriptionSummary(`${fits} and the rest`)).toBe(`${fits}…`);
  });

  it("never cuts inside a character drawn from several code points", () => {
    const family = "👨‍👩‍👧";
    const summary = descriptionSummary(family.repeat(SUMMARY_LENGTH + 10));

    expect(summary).toBe(`${family.repeat(SUMMARY_LENGTH - 1)}…`);
  });

  it("counts a letter with a combining accent as one character", () => {
    const accented = "e\u0301";
    const text = accented.repeat(SUMMARY_LENGTH);

    expect(descriptionSummary(text)).toBe(text);
  });
});
