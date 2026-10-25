import { loadPaymentConfig } from "./payment.config";

describe("loadPaymentConfig", () => {
  const savedEnv = process.env;

  beforeEach(() => {
    // A copy, for the reason `env-consistency.spec.ts` gives.
    process.env = {
      ...savedEnv,
      STRIPE_SECRET_KEY: "sk_test_spec",
      STRIPE_PAYMENT_WEBHOOK_SECRET: "whsec_payment",
      STRIPE_SITE: "spec",
    };
    delete process.env.STRIPE_PAYOUT_WEBHOOK_SECRET;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  it("signs the payout webhook with the payment secret locally, as `stripe listen` does", () => {
    expect(loadPaymentConfig().payoutWebhookSecret).toBe("whsec_payment");
  });

  it("refuses to boot in production without a payout secret of its own", () => {
    process.env.NODE_ENV = "production";

    expect(() => loadPaymentConfig()).toThrow("STRIPE_PAYOUT_WEBHOOK_SECRET");

    process.env.STRIPE_PAYOUT_WEBHOOK_SECRET = "whsec_payout";

    expect(loadPaymentConfig().payoutWebhookSecret).toBe("whsec_payout");
  });
});
