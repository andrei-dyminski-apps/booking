/** An amount of the site's currency back to whole cents, after arithmetic left binary noise. */
export function roundCents(amount: number): number {
  return toCents(amount) / 100;
}

/**
 * Euros to whole cents. The amount is exact to the cent already, so the rounding only takes
 * off the binary noise a multiplication leaves: `120.35 * 100` is `12034.999999999998`.
 * What Stripe is charged and what the idempotency keys are named by both go through this,
 * so a key cannot name another amount than the request it guards.
 */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}
