import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PaymentConfig } from "../src/payment/infrastructure/payment.config";
import { createStripeClient } from "../src/payment/infrastructure/stripe";
import {
  readPayoutCountries,
  renderPayoutCountriesSnapshot,
} from "../src/payout/infrastructure/payout-countries.reading";

/**
 * Rewrites `payout-countries.snapshot.ts` from Stripe's country specs for the platform the
 * key belongs to, and prints what changed. Only reads, so any key will do — a restricted
 * one allowed to read the account and the country specs is enough; the specs are the same
 * in test and live mode, while the platform's country is the account's. The scheduled
 * workflow (`.github/workflows/payout-countries.yml`) runs it and opens a pull request
 * when the file changed.
 */

const SNAPSHOT = join(
  __dirname,
  "../src/payout/infrastructure/payout-countries.snapshot.ts",
);

async function main(): Promise<void> {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (secretKey === undefined || secretKey === "") {
    throw new Error("STRIPE_SECRET_KEY is not set — copy .env.example to .env");
  }

  const config: PaymentConfig = {
    standIn: null,
    secretKey,
    paymentWebhookSecret: "",
    payoutWebhookSecret: "",
    site: "sync",
  };
  const reading = await readPayoutCountries(createStripeClient(config));
  const next = renderPayoutCountriesSnapshot(reading);
  const current = await readFile(SNAPSHOT, "utf8").catch(() => "");

  if (current === next) {
    console.log(
      `Platform country ${reading.platformCountry}: the snapshot's ${String(reading.offered.length)} countries are Stripe's.`,
    );

    return;
  }

  // Each country beside its currency: a spec whose `default_currency` moved rewrites the
  // file with the same countries, and the log has to say which one changed.
  const before = new Map(
    [...current.matchAll(/^ {2}([A-Z]{2}): "([a-z]*)",$/gm)].map(
      ([, country = "", currency = ""]) => [country, currency],
    ),
  );
  const after = new Map(
    reading.offered.map((country) => [
      country,
      reading.currencies.get(country) ?? "",
    ]),
  );
  const added = [...after.keys()].filter((country) => !before.has(country));
  const removed = [...before.keys()].filter((country) => !after.has(country));
  const moved = [...after].flatMap(([country, currency]) => {
    const was = before.get(country);

    return was === undefined || was === currency
      ? []
      : [`${country} ${was} → ${currency}`];
  });

  await writeFile(SNAPSHOT, next);

  console.log(
    [
      `Platform country ${reading.platformCountry}: ${String(reading.offered.length)} countries written.`,
      `Added: ${added.join(", ") || "none"}.`,
      `Removed: ${removed.join(", ") || "none"}.`,
      `Currency changed: ${moved.join(", ") || "none"}.`,
    ].join("\n"),
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
