/**
 * The one currency every price on this site is stored and answered in. A fact about the
 * money already in the database rather than a setting: changing it would restate every
 * price without converting any of them. Lower case because that is how Stripe spells it.
 */
export const CURRENCY = "eur";
