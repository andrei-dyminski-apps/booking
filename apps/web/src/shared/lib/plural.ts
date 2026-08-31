/**
 * A count and the noun it counts, made to agree. Nights and guests are labelled on four
 * screens, and writing the comparison out at each of them is four places for a singular
 * to be forgotten — the same reason a price is formatted in one place.
 *
 * English plurals are a lookup rather than a rule, so an irregular form is an argument
 * instead of something guessed at: `countOf(1, "stay", "stays")` against the `s` this
 * adds by itself. When i18n arrives, `Intl.PluralRules` and a catalogue replace the
 * body of this function and nothing else.
 */
export function countOf(
  count: number,
  noun: string,
  plural = `${noun}s`,
): string {
  return `${count} ${count === 1 ? noun : plural}`;
}
