import { randomUUID } from "node:crypto";
import { cents, CURRENCY } from "../src/payment/domain/money";
import { createStripeClient } from "../src/payment/infrastructure/stripe";
import type { PaymentConfig } from "../src/payment/infrastructure/payment.config";
import { StripePayoutGateway } from "../src/payout/infrastructure/stripe-payout.gateway";

/**
 * Whether the platform can pay a host's connected account, against the sandbox
 * `STRIPE_SECRET_KEY` names: `pnpm --filter @repo/api stripe:probe-transfer acct_…`.
 *
 * The account is one a host opened through the app and finished onboarding by hand — the
 * embedded form is the only way to, since Stripe collects an Express account's requirements
 * itself and refuses the terms of service over the API. The script then does what a payout
 * does: asks `transfersEnabled`, takes a test charge on the platform, and sends a transfer
 * funded by it through the adapter's own `transfer`. A sandbox refuses a transfer to an
 * account whose `stripe_transfers` is not active, so a transfer that goes through is a
 * real answer. It writes to that Stripe account (a charge and a transfer); a test key only.
 */

const AMOUNT = cents(8_500);

async function main(): Promise<void> {
  const accountId = process.argv[2];

  if (accountId === undefined || !accountId.startsWith("acct_")) {
    throw new Error(
      "Usage: stripe:probe-transfer acct_… (a connected account)",
    );
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (secretKey === undefined || !/^(sk|rk)_test_/.test(secretKey)) {
    throw new Error(
      "STRIPE_SECRET_KEY is not a test key — the probe takes a charge and sends a transfer, so it runs against a sandbox only",
    );
  }

  const config: PaymentConfig = {
    standIn: null,
    secretKey,
    paymentWebhookSecret: "",
    payoutWebhookSecret: "",
    site: "probe",
  };
  const stripe = createStripeClient(config);
  const gateway = new StripePayoutGateway(config, stripe);

  const enabled = await gateway.transfersEnabled(accountId, "request");

  console.log(`stripe_transfers active: ${String(enabled)}`);

  if (!enabled) {
    console.log(
      "Finish the account's onboarding in the app first, then run again.",
    );
    process.exitCode = 1;

    return;
  }

  const charge = await stripe.paymentIntents.create({
    amount: 10_000,
    currency: CURRENCY,
    payment_method: "pm_card_visa",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    metadata: { site: "probe" },
  });
  const chargeId =
    typeof charge.latest_charge === "string"
      ? charge.latest_charge
      : charge.latest_charge?.id;

  if (chargeId === undefined) throw new Error("The test charge made no charge");

  console.log(`test charge ${chargeId} (${charge.status})`);

  const sent = await gateway.transfer({
    bookingId: randomUUID(),
    accountId,
    chargeId,
    amount: AMOUNT,
    reservation: 1,
    currency: CURRENCY,
    description: "Payout transfer probe",
  });

  console.log(
    `TRANSFER OK ${sent.id}, ${String(sent.amount)} cents to ${accountId}`,
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
