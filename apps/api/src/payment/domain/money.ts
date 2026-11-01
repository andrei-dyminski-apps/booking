import type { Cents } from "@repo/contracts";

/**
 * The API's money vocabulary. `Cents`, its arithmetic and the currency live in
 * `@repo/contracts`, because the interface counts with the same brand — a response parses
 * into `Cents` there, and a typed-in price has to pass through one conversion to become one —
 * and they are re-exported here so the API imports its money from one place.
 */
export {
  CURRENCY,
  NO_CENTS,
  addCents,
  cents,
  currencySchema,
  maxCents,
  minCents,
  subtractCents,
  type Cents,
  type Currency,
} from "@repo/contracts";

/** An amount as a log line or an error message reads it: `361.05`. */
export function formatCents(amount: Cents): string {
  return (amount / 100).toFixed(2);
}
