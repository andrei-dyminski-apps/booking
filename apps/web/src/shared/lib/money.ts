/**
 * An explicit locale, or the server and the browser would disagree on the separators and
 * React would report the difference as a hydration error.
 *
 * The API counts money in US dollars, exact to the cent, and so does every value
 * that travels back to it — nothing is converted on the way here. What this does add is
 * the dollar sign, the second decimal a stored `120` does not carry and the rounding a multiplication needs:
 * three nights at 120.35 is `361.05000000000007` in binary floating point, and the cent is
 * the scale a price is exact to on both sides of the wire.
 */
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatMoney(amount: number): string {
  return money.format(amount);
}
