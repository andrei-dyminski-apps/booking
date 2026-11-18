import type { PayoutCountry } from "@repo/contracts";

export type CountryOption = { value: PayoutCountry; label: string };

const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

/**
 * The countries a payout account can be opened in, named in English and sorted by name.
 * Built by the server render and handed to the form, so the browser's own region names —
 * another ICU, another wording — never disagree with the markup it hydrates.
 */
export function countryOptions(countries: PayoutCountry[]): CountryOption[] {
  return countries
    .map((value) => ({ value, label: REGION_NAMES.of(value) ?? value }))
    .sort((a, b) => a.label.localeCompare(b.label, "en"));
}
