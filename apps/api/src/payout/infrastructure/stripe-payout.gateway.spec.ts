import Stripe from "stripe";
import type { PaymentConfig } from "../../payment/infrastructure/payment.config";
import { STRIPE_API_VERSION } from "../../payment/infrastructure/stripe";
import {
  PayoutAccountOpeningInProgressError,
  PayoutCountryRefusedError,
  type PayoutHost,
} from "../application/ports/payout-gateway";
import {
  readPayoutCountries,
  StripePayoutGateway,
} from "./stripe-payout.gateway";

const config: PaymentConfig = {
  secretKey: "sk_test_spec",
  paymentWebhookSecret: "whsec_spec",
  payoutWebhookSecret: "whsec_spec",
  site: "spec",
};

const host: PayoutHost = {
  userId: "7d3c1a52-1f0e-4b8f-9a55-0c1f2e3d4b5a",
  email: "host@example.com",
  name: "Harbour Host",
  country: "PL",
};

type Answer = { status: number; body: unknown };

/** A country spec with only the fields the adapter reads. */
const spec = (id: string, transfers: string[], currency: string) => ({
  id,
  object: "country_spec",
  default_currency: currency,
  supported_transfer_countries: transfers,
});

/** A v2 refusal in Stripe's error envelope. */
const refusal = (status: number, error: Record<string, string>): Answer => ({
  status,
  body: { error: { message: "Refused by the spec", ...error } },
});

/**
 * Stripe at the HTTP boundary, as `stripe-payment.gateway.spec.ts` has it: the SDK builds
 * the requests and parses the answers, its own error classes included. The platform is in
 * the US and transfers to PL, DE and a country with no spec; CA and AU have specs and are
 * not on the platform's list.
 */
class FakeStripeApi {
  readonly opened: { idempotencyKey: string | null; body: unknown }[] = [];
  readonly opens: Answer[] = [];
  readonly closes: { path: string; body: unknown }[] = [];
  specReads = 0;

  readonly fetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);

    if (url.pathname === "/v1/account") {
      return Promise.resolve(
        respond({
          status: 200,
          body: { id: "acct_platform", object: "account", country: "US" },
        }),
      );
    }

    if (url.pathname === "/v1/country_specs") {
      this.specReads += 1;

      return Promise.resolve(
        respond({
          status: 200,
          body: {
            object: "list",
            data: [
              spec("US", ["US", "PL", "DE", "ZZ"], "usd"),
              spec("PL", ["PL"], "pln"),
              spec("DE", ["DE"], "eur"),
              spec("CA", ["CA"], "cad"),
              spec("AU", ["AU"], "aud"),
            ],
            has_more: false,
            url: "/v1/country_specs",
          },
        }),
      );
    }

    if (init?.method === "POST" && url.pathname === "/v2/core/accounts") {
      this.opened.push({
        idempotencyKey: new Headers(init.headers).get("Idempotency-Key"),
        body: JSON.parse(typeof init.body === "string" ? init.body : "{}"),
      });

      return Promise.resolve(
        respond(
          this.opens.shift() ?? {
            status: 200,
            body: {
              id: `acct_${String(this.opened.length)}`,
              object: "v2.core.account",
            },
          },
        ),
      );
    }

    if (init?.method === "POST" && url.pathname.endsWith("/close")) {
      this.closes.push({
        path: url.pathname,
        body: JSON.parse(typeof init.body === "string" ? init.body : "{}"),
      });

      return Promise.resolve(
        respond({
          status: 200,
          body: { id: "acct_closed", object: "v2.core.account", closed: true },
        }),
      );
    }

    return Promise.reject(new Error(`Unexpected request to ${url.pathname}`));
  };
}

function respond({ status, body }: Answer): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "request-id": "req_spec" },
  });
}

describe("StripePayoutGateway accounts", () => {
  let api: FakeStripeApi;
  let stripe: Stripe;
  let gateway: StripePayoutGateway;

  beforeEach(() => {
    api = new FakeStripeApi();
    stripe = new Stripe(config.secretKey, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(api.fetch),
      maxNetworkRetries: 0,
      telemetry: false,
    });
    gateway = new StripePayoutGateway(config, stripe);
  });

  it("keys an account by everything it sends, so only the same request replays it", async () => {
    await gateway.createRecipientAccount(host);
    await gateway.createRecipientAccount(host);
    await gateway.createRecipientAccount({ ...host, name: "Renamed Host" });
    await gateway.createRecipientAccount({ ...host, country: "DE" });

    const [first, again, renamed, elsewhere] = api.opened.map(
      (opened) => opened.idempotencyKey,
    );

    expect(first).toMatch(
      new RegExp(`^user-${host.userId}-account-[0-9a-f]{64}$`),
    );
    expect(again).toBe(first);
    expect(new Set([first, renamed, elsewhere]).size).toBe(3);
    expect(api.opened[0]?.body).toMatchObject({
      identity: { country: "pl" },
      defaults: { currency: "pln" },
      metadata: { userId: host.userId },
    });
  });

  it("opens an account in its country's own currency, so the host's local bank takes the payouts", async () => {
    await gateway.createRecipientAccount({ ...host, country: "DE" });
    await gateway.createRecipientAccount({ ...host, country: "US" });
    await gateway.createRecipientAccount({ ...host, country: "CA" });

    expect(
      api.opened.map(
        (opened) =>
          (opened.body as { defaults: { currency: string } }).defaults.currency,
      ),
    ).toEqual(["eur", "usd", "cad"]);
    expect(api.specReads).toBe(1);
  });

  it("refuses a country no spec names without asking Stripe to open anything", async () => {
    const failure = gateway.createRecipientAccount({ ...host, country: "ZZ" });

    await expect(failure).rejects.toBeInstanceOf(PayoutCountryRefusedError);
    await expect(failure).rejects.toMatchObject({
      country: "ZZ",
      reason: "no_country_spec",
    });
    expect(api.opened).toHaveLength(0);
  });

  it("asks for card payments beside the transfers only where Stripe will not open the account without them, and closes whatever it opened", async () => {
    await gateway.createRecipientAccount({ ...host, country: "US" });
    await gateway.createRecipientAccount({ ...host, country: "CA" });
    await gateway.createRecipientAccount({ ...host, country: "DE" });

    const configured = api.opened.map((opened) =>
      Object.keys(
        (opened.body as { configuration: Record<string, unknown> })
          .configuration,
      ).sort(),
    );

    expect(configured).toEqual([
      ["merchant", "recipient"],
      ["merchant", "recipient"],
      ["recipient"],
    ]);
    expect(api.opened[0]?.body).toMatchObject({
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
      },
    });

    await gateway.closeAccount("acct_us", "US");
    await gateway.closeAccount("acct_de", "DE");

    expect(api.closes.map((close) => close.body)).toEqual([
      { applied_configurations: ["merchant", "recipient"] },
      { applied_configurations: ["recipient"] },
    ]);
  });

  it("reads Stripe's refusal of a key in use as another request opening the account", async () => {
    api.opens.push(refusal(409, { type: "idempotency_error" }));

    await expect(gateway.createRecipientAccount(host)).rejects.toBeInstanceOf(
      PayoutAccountOpeningInProgressError,
    );
  });

  it("reads Stripe's refusal of the country's currency as the country refused, and stops offering it", async () => {
    // DE stands in for a country whose spec's currency Stripe refuses after all.
    await expect(gateway.transferCountries()).resolves.toEqual([
      "US",
      "PL",
      "DE",
    ]);
    api.opens.push(
      refusal(400, {
        type: "invalid_request_error",
        code: "account_country_unsupported_currency",
      }),
    );

    const failure = gateway.createRecipientAccount({ ...host, country: "DE" });

    await expect(failure).rejects.toBeInstanceOf(PayoutCountryRefusedError);
    await expect(failure).rejects.toMatchObject({
      country: "DE",
      reason: "account_country_unsupported_currency",
    });
    await expect(gateway.transferCountries()).resolves.toEqual(["US", "PL"]);
    expect(api.specReads).toBe(1);
  });

  it("reads a country that needs another capability, and is not known to, as the country refused", async () => {
    api.opens.push(
      refusal(400, {
        type: "invalid_request_error",
        code: "capability_not_available_without_other_capability",
      }),
    );

    await expect(
      gateway.createRecipientAccount({ ...host, country: "AU" }),
    ).rejects.toBeInstanceOf(PayoutCountryRefusedError);
  });

  it("passes any other refusal on as it is", async () => {
    api.opens.push(
      refusal(400, { type: "invalid_request_error", code: "invalid_fields" }),
    );

    const failure = gateway.createRecipientAccount(host);

    await expect(failure).rejects.toBeInstanceOf(Stripe.errors.StripeError);
    await expect(failure).rejects.not.toBeInstanceOf(PayoutCountryRefusedError);
  });

  it("offers every country the platform transfers to that has a spec, each with its own currency", async () => {
    const reading = await readPayoutCountries(stripe);

    expect(reading).toMatchObject({
      platformCountry: "US",
      transferCountries: ["US", "PL", "DE", "ZZ"],
      offered: ["US", "PL", "DE"],
    });
    expect(Object.fromEntries(reading.currencies)).toEqual({
      US: "usd",
      PL: "pln",
      DE: "eur",
      CA: "cad",
      AU: "aud",
    });
  });
});
