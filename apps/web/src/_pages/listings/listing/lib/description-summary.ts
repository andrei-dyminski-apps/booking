/** How much of a description a search result shows; Google cuts a snippet near it. */
export const SUMMARY_LENGTH = 160;

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** The characters of a text as a reader counts them, each one a string of its own. */
export function charactersOf(text: string): string[] {
  return Array.from(graphemes.segment(text), ({ segment }) => segment);
}

/**
 * An owner's description as a result's snippet: its whitespace run together — a line
 * break means nothing in a `<meta name="description">` — and anything past
 * `SUMMARY_LENGTH` cut at the last word that fits whole, the ellipsis counted.
 *
 * Counted in the characters a reader sees (grapheme clusters) rather than in UTF-16 units
 * or code points, so the cut never lands inside one: not between the halves of a surrogate
 * pair, which `String.prototype.slice` would split, and not inside a family emoji, a flag
 * or a letter with a combining accent, each several code points drawn as one.
 *
 * The word boundary is looked for among the first `SUMMARY_LENGTH` characters, one past
 * what is kept: a space right after the last of them means that word ends there, whole.
 */
export function descriptionSummary(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = charactersOf(flat);

  if (chars.length <= SUMMARY_LENGTH) return flat;

  const space = chars.slice(0, SUMMARY_LENGTH).lastIndexOf(" ");
  const kept = chars.slice(0, space > 0 ? space : SUMMARY_LENGTH - 1);

  return `${kept.join("").trimEnd()}…`;
}
