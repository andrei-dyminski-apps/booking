import { z } from "zod";

/**
 * Money on this contract is a whole number of the currency's minor unit — cents — and
 * every field that carries some says so in its name (`amountCents`, `priceCents`): a bare
 * `amount: 12050` reads as twelve thousand to anybody who forgets the convention, and a
 * name is the one thing a forgetful reader cannot skip. The unit is the one Stripe charges,
 * refunds and transfers in, and a sum of nights stays exact in it, which a sum of
 * fractional dollars does not (`120.35 * 3` is `361.04999999999995`).
 *
 * Turning cents into the currency itself — and the text a person types back into cents —
 * is the interface's job, at its edge, and nothing in between converts.
 */

/**
 * The one currency every amount on this site is stored, charged and answered in. A fact
 * about the money already in the database rather than a setting: changing it would restate
 * every price without converting any of them. ISO 4217, lower case, because that is how
 * Stripe spells it.
 *
 * A booking stores the currency it was charged in beside its amount, so the record says
 * what it is on its own; a listing's prices are in this one. A second currency would be a
 * column on the listing and a list here, and a minor unit that is not always a hundredth —
 * which is why the interface asks `Intl` for the number of decimals rather than dividing
 * by a hundred.
 *
 * `as const` keeps the literal when it is copied into an object, where a plain one widens to
 * `string` and stops being a `Currency`.
 */
export const CURRENCY = "usd" as const;

export const currencySchema = z.enum([CURRENCY]);

export type Currency = z.infer<typeof currencySchema>;

/**
 * An amount in cents, branded: a number read off a response, a row or a provider's object
 * passes this schema (or `cents`) once and is known to be whole and not negative from there
 * on, and a plain number — a dollar amount typed into a box — cannot be handed where cents
 * are expected without going through one of the two. The arithmetic below keeps the brand;
 * `+` and `-` on two amounts give a plain `number`.
 */
export const centsSchema = z.int().nonnegative().brand<"Cents">();

export type Cents = z.infer<typeof centsSchema>;

/**
 * The same two rules as `centsSchema`, as a function: a fraction is the noise the type exists
 * to keep out, and a negative amount is no amount of money anybody holds — so
 * `subtractCents` of more than there is throws rather than handing a debt on as an amount.
 */
export function cents(amount: number): Cents {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(
      `${String(amount)} is not a whole, non-negative number of cents`,
    );
  }

  return amount as Cents;
}

export const NO_CENTS = cents(0);

export function addCents(left: Cents, right: Cents): Cents {
  return cents(left + right);
}

export function subtractCents(left: Cents, right: Cents): Cents {
  return cents(left - right);
}

export function minCents(first: Cents, ...rest: Cents[]): Cents {
  return cents(Math.min(first, ...rest));
}

export function maxCents(first: Cents, ...rest: Cents[]): Cents {
  return cents(Math.max(first, ...rest));
}

/** A rate in basis points — 1500 is 15% — so no fraction of a percent is a float. */
export const BASIS_POINTS = 10_000;

/**
 * `bps` of `amount`, rounded half up. Integer arithmetic throughout: half the divisor is
 * added before the floor, so an exact half rounds up rather than to whatever binary noise
 * the float `0.85 * amount` would leave.
 */
export function shareOf(amount: Cents, bps: number): Cents {
  return cents(Math.floor((amount * bps + BASIS_POINTS / 2) / BASIS_POINTS));
}

/**
 * Stripe's ceiling for one charge (eight digits of cents). A hold above it could never be
 * paid and would only keep its nights off the calendar until it lapsed. The contract's
 * `MAX_PRICE` is the same number, so a single night at the ceiling still fits. On the
 * contract rather than in the API alone, so the booking form can say before the press that
 * a stay is outside what one payment carries — see `chargeRefusal`.
 */
export const MAX_CHARGE = cents(99_999_999);

/**
 * Stripe's floor for one charge; the contract lets a night cost a cent. Checked against the
 * amount after the discount, which is what the payment charges.
 */
export const MIN_CHARGE = cents(50);
