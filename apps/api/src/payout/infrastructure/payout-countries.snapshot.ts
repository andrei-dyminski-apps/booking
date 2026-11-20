// Written by `pnpm --filter @repo/api stripe:sync-countries` from Stripe's country specs
// (scripts/sync-payout-countries.ts); a scheduled workflow proposes a newer one as a pull
// request. Not edited by hand: a country to leave out goes into `EXCLUDED_PAYOUT_COUNTRIES`.

/** The country of the platform's Stripe account the list was read for. */
export const PAYOUT_PLATFORM_COUNTRY = "PL";

/** Every country a host's payout account can be opened in, and the currency it holds. */
export const PAYOUT_COUNTRY_CURRENCIES: Readonly<Record<string, string>> = {
  AT: "eur",
  BE: "eur",
  BG: "eur",
  CA: "cad",
  CH: "chf",
  CY: "eur",
  CZ: "czk",
  DE: "eur",
  DK: "dkk",
  EE: "eur",
  ES: "eur",
  FI: "eur",
  FR: "eur",
  GB: "gbp",
  GI: "gbp",
  GR: "eur",
  HR: "eur",
  HU: "huf",
  IE: "eur",
  IT: "eur",
  LI: "chf",
  LT: "eur",
  LU: "eur",
  LV: "eur",
  MT: "eur",
  NL: "eur",
  NO: "nok",
  PL: "pln",
  PT: "eur",
  RO: "ron",
  SE: "sek",
  SI: "eur",
  SK: "eur",
  US: "usd",
};
