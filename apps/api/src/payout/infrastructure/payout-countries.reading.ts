import { payoutCountrySchema, type PayoutCountry } from "@repo/contracts";
import type Stripe from "stripe";

/**
 * The country specs are one list of over half a megabyte, and the first read of it after a
 * while took a sandbox twenty seconds (2026-11-19) where the next ones took under one. The
 * size is not ours to shrink: Stripe sends the list uncompressed whatever `Accept-Encoding`
 * asks for, and no field of a spec can be left out. That is why the API never reads it: the
 * list is a snapshot in the repository (`payout-countries.snapshot.ts`), written by
 * `scripts/sync-payout-countries.ts`, and only the scripts wait on this read.
 */
export const COUNTRIES_REQUEST = {
  timeout: 30_000,
  maxNetworkRetries: 2,
} satisfies Stripe.RequestOptions;

/**
 * Countries Stripe transfers to that the platform chooses not to offer, each with its
 * reason. The sync leaves them out of the snapshot, so a scheduled run does not propose
 * them again.
 */
export const EXCLUDED_PAYOUT_COUNTRIES: ReadonlyMap<string, string> = new Map<
  string,
  string
>([]);

/** Where this platform can transfer, which of those the host is offered, and in what currency. */
export type PayoutCountryReading = {
  platformCountry: string;
  /** `supported_transfer_countries` of the platform's own spec, as Stripe lists them. */
  transferCountries: string[];
  /**
   * The currency an account opened in a country holds: its spec's `default_currency`, the
   * one a host's local bank account is in. Every country Stripe has a spec for.
   */
  currencies: ReadonlyMap<string, string>;
  /** Sorted, so the snapshot written from it changes only when the list does. */
  offered: PayoutCountry[];
};

/**
 * `supported_transfer_countries` of the platform's own country spec — the regions Stripe
 * lets this platform send a transfer to, so an account opened anywhere else could finish
 * onboarding and still never be paid. An account is opened in its country's own currency
 * (`currencies`), so a host gives the bank account they have rather than one in the
 * platform's; Stripe converts a transfer in the stay's currency on its way in. A country
 * with no spec, a code not spelled the way the contract spells one, or one in
 * `EXCLUDED_PAYOUT_COUNTRIES` is left out rather than failing the list.
 *
 * Leaving out a country with no spec is not about its currency alone, which Stripe would
 * infer from the country if none were sent (the spec's own, checked for DE, GB, CH and US).
 * The transfer countries of a platform in Poland include IS, MC and SM, which have no spec,
 * and a sandbox refused `stripe_transfers` in IS with an error carrying no `code`
 * (2026-11-19).
 */
export async function readPayoutCountries(
  stripe: Stripe,
  request: Stripe.RequestOptions = COUNTRIES_REQUEST,
): Promise<PayoutCountryReading> {
  const platform = await stripe.accounts.retrieveCurrent(undefined, request);

  if (platform.country === undefined) {
    throw new Error("The platform's Stripe account names no country");
  }

  const specs = new Map<string, Stripe.CountrySpec>();

  for await (const spec of stripe.countrySpecs.list({ limit: 100 }, request)) {
    specs.set(spec.id, spec);
  }

  const own = specs.get(platform.country);

  if (own === undefined) {
    throw new Error(
      `Stripe has no country spec for the platform's country ${platform.country}`,
    );
  }

  const currencies = new Map(
    [...specs.values()].map((spec) => [spec.id, spec.default_currency]),
  );

  return {
    platformCountry: platform.country,
    transferCountries: own.supported_transfer_countries,
    currencies,
    offered: own.supported_transfer_countries
      .filter(
        (country) =>
          payoutCountrySchema.safeParse(country).success &&
          currencies.has(country) &&
          !EXCLUDED_PAYOUT_COUNTRIES.has(country),
      )
      .sort(),
  };
}

/**
 * The source of `payout-countries.snapshot.ts`, spelled the way Prettier prints it, so a
 * file the sync wrote passes `pnpm lint` as it is. A reading with no country to offer is
 * refused rather than written: it would take the payouts form away from every host, and it
 * means a reading gone wrong — every country excluded, or a spec with no transfer countries.
 */
export function renderPayoutCountriesSnapshot(
  reading: PayoutCountryReading,
): string {
  if (reading.offered.length === 0) {
    throw new Error(
      `No payout country to offer for a platform in ${reading.platformCountry} — the snapshot is left as it is`,
    );
  }

  const entries = reading.offered.map(
    (country) => `  ${country}: "${reading.currencies.get(country) ?? ""}",\n`,
  );

  return [
    "// Written by `pnpm --filter @repo/api stripe:sync-countries` from Stripe's country specs",
    "// (scripts/sync-payout-countries.ts); a scheduled workflow proposes a newer one as a pull",
    "// request. Not edited by hand: a country to leave out goes into `EXCLUDED_PAYOUT_COUNTRIES`.",
    "",
    "/** The country of the platform's Stripe account the list was read for. */",
    `export const PAYOUT_PLATFORM_COUNTRY = "${reading.platformCountry}";`,
    "",
    "/** Every country a host's payout account can be opened in, and the currency it holds. */",
    "export const PAYOUT_COUNTRY_CURRENCIES: Readonly<Record<string, string>> = {",
    `${entries.join("")}};`,
    "",
  ].join("\n");
}
