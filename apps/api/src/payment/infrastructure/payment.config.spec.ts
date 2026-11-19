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
    delete process.env.STRIPE_OFF;
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

  describe("with Stripe off", () => {
    beforeEach(() => {
      process.env.STRIPE_OFF = "true";
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_PAYMENT_WEBHOOK_SECRET;
    });

    it("boots without a key or a webhook secret", () => {
      expect(loadPaymentConfig().off).toBe(true);
    });

    it("accepts no webhook that a secret from the environment would sign", () => {
      process.env.STRIPE_PAYMENT_WEBHOOK_SECRET = "whsec_payment";

      const config = loadPaymentConfig();

      expect(config.paymentWebhookSecret).not.toBe("whsec_payment");
      expect(config.paymentWebhookSecret).not.toBe(
        loadPaymentConfig().paymentWebhookSecret,
      );
    });

    it("refuses to boot in production", () => {
      process.env.NODE_ENV = "production";

      expect(() => loadPaymentConfig()).toThrow("STRIPE_OFF");
    });

    it("refuses a value that is neither on nor off", () => {
      process.env.STRIPE_OFF = "1";

      expect(() => loadPaymentConfig()).toThrow("STRIPE_OFF");
    });
  });

  it("leaves Stripe on for an explicit false", () => {
    process.env.STRIPE_OFF = "false";

    expect(loadPaymentConfig().off).toBe(false);
  });
});
