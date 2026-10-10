/**
 * A box hands over text and the contract wants numbers — a price to the cent and a whole
 * capacity. An empty box is not a zero: handing the schema `undefined` makes it say the
 * field is missing, which is what happened, instead of refusing a number nobody typed.
 * Text that is not a number at all becomes `NaN` and is refused as one.
 *
 * Not only text arrives here, though: `react-hook-form` runs a default value through
 * `setValueAs` too, and the listing being edited hands over numbers already.
 */
export function toNumber(value: string | number): number | undefined {
  if (typeof value === "number") return value;
  return value.trim() === "" ? undefined : Number(value);
}
