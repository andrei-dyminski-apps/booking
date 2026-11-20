import Stripe from "stripe";
import { STRIPE_API_VERSION } from "../../payment/infrastructure/stripe";
import { checkPlatformCountry } from "./platform-country.check";

/** Stripe answering a read of the platform's own account, or refusing it. */
function stripeAnswering(answer: { status: number; body: unknown }): Stripe {
  return new Stripe("sk_test_spec", {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(() =>
      Promise.resolve(
        new Response(JSON.stringify(answer.body), {
          status: answer.status,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
    maxNetworkRetries: 0,
    telemetry: false,
  });
}

const platformIn = (country: string) =>
  stripeAnswering({
    status: 200,
    body: { id: "acct_platform", object: "account", country },
  });

describe("checkPlatformCountry", () => {
  const warnings: string[] = [];
  const logger = { warn: (message: string) => warnings.push(message) };

  beforeEach(() => {
    warnings.length = 0;
  });

  it("lets the boot go on when the key's platform is in the snapshot's country", async () => {
    await expect(
      checkPlatformCountry(platformIn("PL"), "PL", logger),
    ).resolves.toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("stops the boot when the key belongs to a platform in another country", async () => {
    await expect(
      checkPlatformCountry(platformIn("US"), "PL", logger),
    ).rejects.toThrow(
      "STRIPE_SECRET_KEY belongs to a platform in US, while the payout countries are a snapshot for one in PL",
    );
  });

  it("only warns when Stripe cannot be asked, since the key is no less right for it", async () => {
    const down = stripeAnswering({
      status: 500,
      body: { error: { type: "api_error", message: "Stripe is down" } },
    });

    await expect(
      checkPlatformCountry(down, "PL", logger),
    ).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("snapshot's PL");
  });
});
