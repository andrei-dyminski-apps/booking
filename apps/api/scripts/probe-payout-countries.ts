import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import type { PaymentConfig } from "../src/payment/infrastructure/payment.config";
import { createStripeClient } from "../src/payment/infrastructure/stripe";
import { PayoutCountryRefusedError } from "../src/payout/application/ports/payout-gateway";
import {
  EXCLUDED_PAYOUT_COUNTRIES,
  readPayoutCountries,
} from "../src/payout/infrastructure/payout-countries.reading";
import {
  PAYOUT_COUNTRY_CURRENCIES,
  PAYOUT_PLATFORM_COUNTRY,
} from "../src/payout/infrastructure/payout-countries.snapshot";
import { StripePayoutGateway } from "../src/payout/infrastructure/stripe-payout.gateway";

/**
 * Compares the countries the payouts form offers — the snapshot, `payout-countries.snapshot.ts`
 * — with the ones Stripe actually opens an account in, against the sandbox
 * `STRIPE_SECRET_KEY` names. The snapshot is a reading of the country specs, each account in
 * the currency it holds for the country, and Stripe checks an account by rules of its own, so the two
 * can disagree either way: a country offered that Stripe refuses, or one left out that it
 * would open. A snapshot that no longer matches the specs is reported first: that is
 * `stripe:sync-countries`' to fix.
 *
 * Every country the platform transfers to is opened through the adapter itself — the very
 * body and key a host's request sends — and the account closed at once. The adapter asks
 * once more with `merchant` where Stripe wants it and `MERCHANT_COUNTRIES` did not know
 * (`learntMerchantCountries`); a host never sees that, so the probe reports such a country
 * apart (`NEEDS MERCHANT`) and fails the run, rather than counting the second try as the
 * list being right. A country with no spec, or one in `EXCLUDED_PAYOUT_COUNTRIES`, is not
 * asked about: the snapshot leaves it out by design, so nothing Stripe answers could make
 * the list wrong. Opening proves the account can exist, not that a transfer reaches it: that takes onboarding finished and a
 * transfer sent, by hand. A test key only: a live one would open real accounts.
 */

const CONCURRENCY = 4;

type Outcome = {
  country: string;
  /**
   * The currency the account is opened in: the snapshot's for a country it holds, as a host's
   * request sends it, the spec's `default_currency` for one it leaves out; `null` with neither.
   */
  currency: string | null;
  offered: boolean;
  /** `null` when Stripe could not be asked — a timeout, a dropped connection. */
  opened: boolean | null;
  /** Why the country was not asked about at all; `null` when it was. */
  skipped: string | null;
  /** Opened only once asked again with `merchant`, which `MERCHANT_COUNTRIES` does not list. */
  needsMerchant: boolean;
  detail: string;
};

async function main(): Promise<void> {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (secretKey === undefined || secretKey === "") {
    throw new Error("STRIPE_SECRET_KEY is not set — copy .env.example to .env");
  }

  if (!/^(sk|rk)_test_/.test(secretKey)) {
    throw new Error(
      "STRIPE_SECRET_KEY is not a test key — the probe opens and closes accounts, so it runs against a sandbox only",
    );
  }

  // The adapter as the API builds it, minus the webhook secrets nothing here reads.
  const config: PaymentConfig = {
    standIn: null,
    secretKey,
    paymentWebhookSecret: "",
    payoutWebhookSecret: "",
    site: "probe",
  };
  const stripe = createStripeClient(config);
  const reading = await readPayoutCountries(stripe);
  // Every country with a spec, so one the snapshot leaves out is asked about too — but a
  // country the snapshot holds in its own currency, the body a host's request sends, even
  // where the spec's `default_currency` has moved since.
  const currencies: Record<string, string> = {
    ...Object.fromEntries(reading.currencies),
    ...PAYOUT_COUNTRY_CURRENCIES,
  };
  const gateway = new StripePayoutGateway(config, stripe, currencies);
  const offered = new Set<string>(Object.keys(PAYOUT_COUNTRY_CURRENCIES));

  if (reading.platformCountry !== PAYOUT_PLATFORM_COUNTRY) {
    throw new Error(
      `The snapshot was read for a platform in ${PAYOUT_PLATFORM_COUNTRY}, this key's is in ${reading.platformCountry}`,
    );
  }

  // Each country beside its currency: a spec whose `default_currency` moved leaves the set
  // of countries as it was and the snapshot opening accounts in the old one.
  const specPairs = reading.offered.map(
    (country) => `${country}:${reading.currencies.get(country) ?? ""}`,
  );
  const snapshotPairs = Object.entries(PAYOUT_COUNTRY_CURRENCIES).map(
    ([country, currency]) => `${country}:${currency}`,
  );

  const snapshotStale = specPairs.join() !== snapshotPairs.join();

  if (snapshotStale) {
    console.log(
      "The snapshot differs from Stripe's country specs — run `stripe:sync-countries`.",
    );
    process.exitCode = 1;
  }
  // One run's accounts share a user id of their own, so a rerun is never answered with an
  // account this one closed.
  const userId = `probe-${randomUUID()}`;

  console.log(
    `Platform country ${reading.platformCountry}: ${String(reading.transferCountries.length)} transfer countries, ${String(offered.size)} offered. Probing…`,
  );

  const probes = await eachLimited(
    reading.transferCountries,
    CONCURRENCY,
    async (country) => {
      const currency = currencies[country] ?? null;
      const skipped =
        currency === null
          ? "no country spec"
          : (EXCLUDED_PAYOUT_COUNTRIES.get(country) ?? null);

      return {
        country,
        currency,
        offered: offered.has(country),
        skipped,
        ...(skipped === null
          ? await openAndClose(gateway, userId, country)
          : { opened: null, detail: skipped }),
      };
    },
  );
  // Read once every country has been asked: the adapter learns as the probes run.
  const learnt = new Set(gateway.learntMerchantCountries());
  const outcomes = probes.map((probe): Outcome => ({
    ...probe,
    needsMerchant: probe.opened === true && learnt.has(probe.country),
  }));

  for (const outcome of outcomes) {
    console.log(
      [
        outcome.country,
        outcome.currency ?? "-",
        outcome.offered ? "offered" : "left out",
        outcome.skipped !== null
          ? "not asked"
          : outcome.opened === null
            ? "UNKNOWN"
            : outcome.opened
              ? "opens"
              : "refused",
        verdictOf(outcome),
        outcome.needsMerchant
          ? `add ${outcome.country} to MERCHANT_COUNTRIES ${outcome.detail}`.trim()
          : outcome.detail,
      ].join("\t"),
    );
  }

  const wrong = outcomes.filter((outcome) => verdictOf(outcome) !== "ok");
  const toAdd = outcomes
    .filter((outcome) => outcome.needsMerchant)
    .map((outcome) => outcome.country);

  if (toAdd.length > 0) {
    console.log(
      `\nStripe opens a recipient account only with merchant card payments in ${toAdd.join(", ")} — add them to MERCHANT_COUNTRIES in stripe-payout.gateway.ts.`,
    );
  }

  if (wrong.length > 0) {
    console.log(
      `\n${String(wrong.length)} of ${String(outcomes.length)} countries disagree with the list, open only with merchant or could not be probed.`,
    );
    process.exitCode = 1;
  } else if (snapshotStale) {
    console.log(
      `\nAll ${String(outcomes.length)} countries agree with the list, but the snapshot is out of date — run \`stripe:sync-countries\`.`,
    );
  } else {
    console.log(
      `\nAll ${String(outcomes.length)} countries agree with the list.`,
    );
  }
}

async function openAndClose(
  gateway: StripePayoutGateway,
  userId: string,
  country: string,
): Promise<Pick<Outcome, "opened" | "detail">> {
  let accountId: string;

  try {
    accountId = await gateway.createRecipientAccount({
      userId,
      email: `probe+${country.toLowerCase()}@example.com`,
      name: "Payout country probe",
      country,
    });
  } catch (error) {
    if (error instanceof PayoutCountryRefusedError) {
      return { opened: false, detail: error.reason };
    }

    // A refusal the adapter does not recognise as the country's: printed with its code, so
    // a new one can join `COUNTRY_REFUSALS` in the adapter.
    if (
      error instanceof Stripe.errors.StripeError &&
      error.statusCode !== undefined &&
      error.statusCode < 500
    ) {
      return {
        opened: false,
        detail: `${error.code ?? error.type}: ${error.message}`,
      };
    }

    return { opened: null, detail: String(error) };
  }

  try {
    await gateway.closeAccount(accountId);

    return { opened: true, detail: "" };
  } catch (error) {
    return {
      opened: true,
      detail: `${accountId} not closed, close it in the Dashboard: ${String(error)}`,
    };
  }
}

/**
 * `ok` when Stripe agrees with the list as it stands, or when the country was not asked
 * about and the list leaves it out; otherwise which way it disagrees, or that the country
 * opened only on the adapter's second try.
 */
function verdictOf({
  offered,
  opened,
  skipped,
  needsMerchant,
}: Outcome): string {
  if (skipped !== null) return offered ? "OFFERED BUT SKIPPED" : "ok";
  if (opened === null) return "UNPROBED";
  if (offered !== opened) {
    return offered ? "OFFERED BUT REFUSED" : "LEFT OUT BUT OPENS";
  }

  return needsMerchant ? "NEEDS MERCHANT" : "ok";
}

/** `run` over `items`, at most `limit` at a time, the answers in the order of the items. */
async function eachLimited<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const answers = new Map<number, R>();
  // One iterator shared by every worker: each `next` hands out the next item once.
  const queue = items.entries();

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (const [index, item] of queue) {
        answers.set(index, await run(item));
      }
    }),
  );

  return items.flatMap((_, index) => {
    const answer = answers.get(index);

    return answer === undefined ? [] : [answer];
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
