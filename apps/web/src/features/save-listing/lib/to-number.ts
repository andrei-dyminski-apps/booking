/**
 * A box hands over text and the contract wants a number — the capacity, a whole one. An
 * empty box is not a zero: handing the schema `undefined` makes it say the field is
 * missing, which is what happened, instead of refusing a number nobody typed. Text that is
 * not a number at all becomes `NaN` and is refused as one. The prices do not come through
 * here: they are typed in the currency and sent in cents, which `listingFormSchema` does.
 *
 * Not only text arrives here, though: `react-hook-form` runs a default value through
 * `setValueAs` too, and the capacity of the listing being edited is a number already.
 */
export function toNumber(value: string | number): number | undefined {
  if (typeof value === "number") return value;
  return value.trim() === "" ? undefined : Number(value);
}
