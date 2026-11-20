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
  renderPayoutCountriesSnapshot,
} from "./payout-countries.reading";
import { PAYOUT_COUNTRY_CURRENCIES } from "./payout-countries.snapshot";
import { StripePayoutGateway } from "./stripe-payout.gateway";

const config: PaymentConfig = {
  standIn: null,
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

/** The adapter's table of countries, in place of the snapshot the sync rewrites. */
const countries = { US: "usd", PL: "pln", DE: "eur", CA: "cad", AU: "aud" };

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
  /** What each account opened carries, as a read of it answers. */
  readonly configurations = new Map<string, string[]>();
  /** The accounts a close has reached, which a read of them answers as `closed`. */
  readonly closedIds = new Set<string>();
  /** The accounts a read answers with a `404`, as Stripe would one it no longer shows. */
  readonly missingIds = new Set<string>();
  specReads = 0;
  accountReads = 0;
  /** How many reads of the country specs Stripe answers with a `500` before the list. */
  specFailures = 0;

  readonly fetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);

    if (url.pathname === "/v1/account") {
      this.accountReads += 1;

      return Promise.resolve(
        respond({
          status: 200,
          body: { id: "acct_platform", object: "account", country: "US" },
        }),
      );
    }

    if (url.pathname === "/v1/country_specs") {
      this.specReads += 1;

      if (this.specFailures > 0) {
        this.specFailures -= 1;

        return Promise.resolve(
          respond({
            status: 500,
            body: { error: { type: "api_error", message: "Stripe is down" } },
          }),
        );
      }

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
      const body = JSON.parse(
        typeof init.body === "string" ? init.body : "{}",
      ) as { configuration: Record<string, unknown> };

      this.opened.push({
        idempotencyKey: new Headers(init.headers).get("Idempotency-Key"),
        body,
      });

      const answer = this.opens.shift();

      if (answer !== undefined) return Promise.resolve(respond(answer));

      const id = `acct_${String(this.opened.length)}`;

      this.configurations.set(id, Object.keys(body.configuration).sort());

      return Promise.resolve(
        respond({ status: 200, body: { id, object: "v2.core.account" } }),
      );
    }

    if (
      (init?.method ?? "GET") === "GET" &&
      url.pathname.startsWith("/v2/core/accounts/")
    ) {
      const id = url.pathname.slice("/v2/core/accounts/".length);

      if (this.missingIds.has(id)) {
        return Promise.resolve(
          respond(
            refusal(404, {
              type: "invalid_request_error",
              code: "resource_missing",
            }),
          ),
        );
      }

      return Promise.resolve(
        respond({
          status: 200,
          body: {
            id,
            object: "v2.core.account",
            applied_configurations: this.configurations.get(id) ?? [],
            closed: this.closedIds.has(id),
          },
        }),
      );
    }

    if (init?.method === "POST" && url.pathname.endsWith("/close")) {
      this.closedIds.add(
        url.pathname.slice("/v2/core/accounts/".length, -"/close".length),
      );
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
    gateway = new StripePayoutGateway(config, stripe, countries);
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
  });

  it("refuses a country the snapshot does not hold without asking Stripe to open anything", async () => {
    const failure = gateway.createRecipientAccount({ ...host, country: "ZZ" });

    await expect(failure).rejects.toBeInstanceOf(PayoutCountryRefusedError);
    await expect(failure).rejects.toMatchObject({
      country: "ZZ",
      reason: "not_in_snapshot",
    });
    expect(api.opened).toHaveLength(0);
  });

  it("asks for card payments beside the transfers only where Stripe will not open the account without them, and closes whatever it opened", async () => {
    const us = await gateway.createRecipientAccount({ ...host, country: "US" });
    await gateway.createRecipientAccount({ ...host, country: "CA" });
    const de = await gateway.createRecipientAccount({ ...host, country: "DE" });

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

    await gateway.closeAccount(us);
    await gateway.closeAccount(de);

    expect(api.closes.map((close) => close.body)).toEqual([
      { applied_configurations: ["merchant", "recipient"] },
      { applied_configurations: ["recipient"] },
    ]);
  });

  it("leaves an account closed already alone, as the retry of a close whose answer was lost", async () => {
    const de = await gateway.createRecipientAccount({ ...host, country: "DE" });

    await gateway.closeAccount(de);
    await gateway.closeAccount(de);

    expect(api.closes).toHaveLength(1);
  });

  it("takes an account Stripe no longer shows as closed rather than failing the retry", async () => {
    const de = await gateway.createRecipientAccount({ ...host, country: "DE" });

    api.missingIds.add(de);

    await expect(gateway.closeAccount(de)).resolves.toBeUndefined();
    expect(api.closes).toHaveLength(0);
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
      "CA",
      "AU",
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
    await expect(gateway.transferCountries()).resolves.toEqual([
      "US",
      "PL",
      "CA",
      "AU",
    ]);
  });

  it("asks again with card payments where Stripe wants them and the list did not know, and from then on asks with them at once", async () => {
    api.opens.push(
      refusal(400, {
        type: "invalid_request_error",
        code: "capability_not_available_without_other_capability",
      }),
    );

    const au = await gateway.createRecipientAccount({ ...host, country: "AU" });
    await gateway.createRecipientAccount({ ...host, country: "AU" });

    const configured = api.opened.map((opened) =>
      Object.keys(
        (opened.body as { configuration: Record<string, unknown> })
          .configuration,
      ).sort(),
    );

    expect(configured).toEqual([
      ["recipient"],
      ["merchant", "recipient"],
      ["merchant", "recipient"],
    ]);
    expect(api.opened[1]?.idempotencyKey).not.toBe(
      api.opened[0]?.idempotencyKey,
    );
    // Learnt beyond the list, which the probe reports; US and CA are on it already.
    await gateway.createRecipientAccount({ ...host, country: "US" });
    expect(gateway.learntMerchantCountries()).toEqual(["AU"]);

    // Closing names what Stripe says the account carries, the learnt merchant included.
    await gateway.closeAccount(au);

    expect(api.closes.map((close) => close.body)).toEqual([
      { applied_configurations: ["merchant", "recipient"] },
    ]);
  });

  it("reads a country refused with card payments asked for as well as the country refused", async () => {
    const needsMerchant = refusal(400, {
      type: "invalid_request_error",
      code: "capability_not_available_without_other_capability",
    });

    api.opens.push(needsMerchant, needsMerchant);

    await expect(
      gateway.createRecipientAccount({ ...host, country: "AU" }),
    ).rejects.toBeInstanceOf(PayoutCountryRefusedError);
    expect(api.opened).toHaveLength(2);
    await expect(gateway.transferCountries()).resolves.not.toContain("AU");
    // Refused either way, so not a country to add to `MERCHANT_COUNTRIES`.
    expect(gateway.learntMerchantCountries()).toEqual([]);
  });

  it("passes any other refusal on as it is", async () => {
    api.opens.push(
      refusal(400, { type: "invalid_request_error", code: "invalid_fields" }),
    );

    const failure = gateway.createRecipientAccount(host);

    await expect(failure).rejects.toBeInstanceOf(Stripe.errors.StripeError);
    await expect(failure).rejects.not.toBeInstanceOf(PayoutCountryRefusedError);
  });

  it("answers the countries from its table without asking Stripe", async () => {
    await expect(gateway.transferCountries()).resolves.toEqual(
      Object.keys(countries),
    );
    expect(api.accountReads + api.specReads).toBe(0);
  });

  it("answers the snapshot's countries when given no table", async () => {
    await expect(
      new StripePayoutGateway(config, stripe).transferCountries(),
    ).resolves.toEqual(Object.keys(PAYOUT_COUNTRY_CURRENCIES));
  });

  it("retries a read of the country specs, which only a script waits on", async () => {
    api.specFailures = 2;

    await expect(readPayoutCountries(stripe)).resolves.toMatchObject({
      offered: ["DE", "PL", "US"],
    });
    expect(api.specReads).toBe(3);
  });

  it("offers every country the platform transfers to that has a spec, sorted, each with its own currency", async () => {
    const reading = await readPayoutCountries(stripe);

    expect(reading).toMatchObject({
      platformCountry: "US",
      transferCountries: ["US", "PL", "DE", "ZZ"],
      offered: ["DE", "PL", "US"],
    });
    expect(Object.fromEntries(reading.currencies)).toEqual({
      US: "usd",
      PL: "pln",
      DE: "eur",
      CA: "cad",
      AU: "aud",
    });
  });

  it("writes the snapshot as the platform's country and each offered country's currency", async () => {
    const source = renderPayoutCountriesSnapshot(
      await readPayoutCountries(stripe),
    );

    expect(source).toContain('export const PAYOUT_PLATFORM_COUNTRY = "US";');
    expect(source).toContain(
      '= {\n  DE: "eur",\n  PL: "pln",\n  US: "usd",\n};\n',
    );
  });

  it("refuses to write a snapshot with no country to offer", async () => {
    const reading = await readPayoutCountries(stripe);

    expect(() =>
      renderPayoutCountriesSnapshot({ ...reading, offered: [] }),
    ).toThrow("No payout country to offer for a platform in US");
  });
});
