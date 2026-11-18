import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import type { PaymentConfig } from "../src/payment/infrastructure/payment.config";
import { createStripeClient } from "../src/payment/infrastructure/stripe";
import { PayoutCountryRefusedError } from "../src/payout/application/ports/payout-gateway";
import {
  readPayoutCountries,
  StripePayoutGateway,
} from "../src/payout/infrastructure/stripe-payout.gateway";

/**
 * Compares the countries the payouts form offers with the ones Stripe actually opens an
 * account in, against the sandbox `STRIPE_SECRET_KEY` names. The list is a reading of the
 * country specs (`readPayoutCountries`), each account in its spec's `default_currency`, and
 * Stripe checks an account by rules of its own, so the two can disagree either way: a
 * country offered that Stripe refuses, or one left out that it would open.
 *
 * Every country the platform transfers to is opened through the adapter itself — the very
 * body and key a host's request sends — and the account closed at once. Opening proves the
 * account can exist, not that a transfer reaches it: that takes onboarding finished and a
 * transfer sent, by hand. A test key only: a live one would open real accounts.
 */

const CONCURRENCY = 4;

type Outcome = {
  country: string;
  /** The spec's `default_currency` the account is opened in; `null` with no spec. */
  currency: string | null;
  offered: boolean;
  /** `null` when Stripe could not be asked — a timeout, a dropped connection. */
  opened: boolean | null;
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
    secretKey,
    paymentWebhookSecret: "",
    payoutWebhookSecret: "",
    site: "probe",
  };
  const stripe = createStripeClient(config);
  const gateway = new StripePayoutGateway(config, stripe);
  const reading = await readPayoutCountries(stripe);
  const offered = new Set<string>(reading.offered);
  // One run's accounts share a user id of their own, so a rerun is never answered with an
  // account this one closed.
  const userId = `probe-${randomUUID()}`;

  console.log(
    `Platform country ${reading.platformCountry}: ${String(reading.transferCountries.length)} transfer countries, ${String(offered.size)} offered. Probing…`,
  );

  const outcomes = await eachLimited(
    reading.transferCountries,
    CONCURRENCY,
    async (country): Promise<Outcome> => {
      const probe = await openAndClose(gateway, userId, country);

      return {
        country,
        currency: reading.currencies.get(country) ?? null,
        offered: offered.has(country),
        ...probe,
      };
    },
  );

  for (const outcome of outcomes) {
    console.log(
      [
        outcome.country,
        outcome.currency ?? "-",
        outcome.offered ? "offered" : "left out",
        outcome.opened === null
          ? "UNKNOWN"
          : outcome.opened
            ? "opens"
            : "refused",
        verdictOf(outcome),
        outcome.detail,
      ].join("\t"),
    );
  }

  const wrong = outcomes.filter((outcome) => verdictOf(outcome) !== "ok");

  if (wrong.length > 0) {
    console.log(
      `\n${String(wrong.length)} of ${String(outcomes.length)} countries disagree with the list or could not be probed.`,
    );
    process.exitCode = 1;
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
    await gateway.closeAccount(accountId, country);

    return { opened: true, detail: "" };
  } catch (error) {
    return {
      opened: true,
      detail: `${accountId} not closed, close it in the Dashboard: ${String(error)}`,
    };
  }
}

/** `ok` when Stripe agrees with the list; otherwise which way it disagrees. */
function verdictOf({ offered, opened }: Outcome): string {
  if (opened === null) return "UNPROBED";
  if (offered === opened) return "ok";

  return offered ? "OFFERED BUT REFUSED" : "LEFT OUT BUT OPENS";
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
