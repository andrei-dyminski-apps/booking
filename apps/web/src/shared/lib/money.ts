import {
  CURRENCY,
  type Cents,
  type Currency,
  type PricedNight,
} from "@repo/contracts";
import { countOf } from "./plural";

/**
 * The edge where money changes units, in one place. Everything that travels — the contract,
 * the API, Stripe — counts whole cents (`Cents`), and only the screen deals in the currency
 * itself: `formatMoney` on the way out, `centsFromInput` on the way back in. Nothing else
 * in this app multiplies or divides an amount by a hundred.
 *
 * How many decimals a currency has is asked of `Intl` rather than assumed to be two: a
 * yen has none and a dinar three, and the day a second currency arrives that is the one
 * assumption that would quietly be wrong.
 *
 * An explicit locale, or the server and the browser would disagree on the separators and
 * React would report the difference as a hydration error.
 */
const formatters = new Map<Currency, Intl.NumberFormat>();

function formatterOf(currency: Currency): Intl.NumberFormat {
  let formatter = formatters.get(currency);

  if (formatter === undefined) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    });
    formatters.set(currency, formatter);
  }

  return formatter;
}

/** How many of the minor unit make one of the currency, as a power of ten: 2 for cents. */
function minorDigitsOf(currency: Currency): number {
  return formatterOf(currency).resolvedOptions().maximumFractionDigits ?? 2;
}

/** `12050` cents as a person reads it: `$120.50`. */
export function formatMoney(
  amount: Cents,
  currency: Currency = CURRENCY,
): string {
  return formatterOf(currency).format(amount / 10 ** minorDigitsOf(currency));
}

/**
 * What a money box holds, as text: `12050` cents is `120.50`. The default value of a box
 * that edits an amount the API answered with.
 */
export function inputOfCents(
  amount: Cents,
  currency: Currency = CURRENCY,
): string {
  const digits = minorDigitsOf(currency);

  return (amount / 10 ** digits).toFixed(digits);
}

/**
 * Text typed into a money box, in cents: `120.5` is `12050`. Not a `Cents`, and that is the
 * point — what comes out is handed to a contract schema, which is what brands it, so every
 * rule a price obeys is still the contract's to apply and to word:
 *
 * - an empty box is `undefined`, and the schema says the price is required;
 * - an amount is shifted by its digits rather than multiplied, so `120.35` is exactly
 *   `12035` and not `12034.999999999998`. Zeros after the last digit of the fraction say
 *   nothing, so `19.990` is still `1999` — multiplied, it would be `1998.9999999999998` and
 *   refused as finer than a cent — and `.07` is `7`;
 * - digits past the cent that are not zeros put the amount between two cents, and half a
 *   cent is added to the cents written to say so, so it is refused as finer than one
 *   however many digits there are — `Number` would round `120.5000000000000001` to
 *   `120.5` and store a price nobody typed;
 * - a whole part too long to count in cents exactly is above every ceiling a price has, so
 *   the largest exact count stands in for it and the schema refuses it as too high —
 *   multiplied as it is, it would come out an unsafe integer and be refused as finer than
 *   a cent as well, which the visitor never typed;
 * - a sign is kept, so a minus is refused as not more than zero;
 * - anything else — an exponent, a second point, text that is not a number at all — is
 *   `NaN`, which the schema refuses as not a number rather than reading it some way the
 *   visitor did not mean.
 */
export function centsFromInput(
  text: string,
  currency: Currency = CURRENCY,
): number | undefined {
  const trimmed = text.trim();

  if (trimmed === "") return undefined;

  const written = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  const [, sign = "", whole = "", decimals = ""] = written ?? [];

  if (written === null || whole + decimals === "") return Number.NaN;

  const digits = minorDigitsOf(currency);
  const fraction = decimals.replace(/0+$/, "");
  const minor =
    Number(whole) * 10 ** digits +
    Number(fraction.slice(0, digits).padEnd(digits, "0"));
  const amount =
    minor > Number.MAX_SAFE_INTEGER
      ? Number.MAX_SAFE_INTEGER
      : minor + (fraction.length > digits ? 0.5 : 0);

  return sign === "-" ? -amount : amount;
}

/**
 * The nights of a stay as a sum, grouped by what they cost in the order the prices first
 * appear — `2 nights × $120.00 + 1 night × $150.00` reads as arithmetic, where one line per
 * night would be a list as long as the stay. The listing page quotes the dates being typed
 * with it and a stay's own page the nights it was charged for, so the two read alike.
 */
export function nightsBreakdown(
  nights: readonly PricedNight[],
  currency: Currency = CURRENCY,
): string {
  const counts = new Map<Cents, number>();

  for (const { priceCents } of nights) {
    counts.set(priceCents, (counts.get(priceCents) ?? 0) + 1);
  }

  return [...counts]
    .map(
      ([price, count]) =>
        `${countOf(count, "night")} × ${formatMoney(price, currency)}`,
    )
    .join(" + ");
}
