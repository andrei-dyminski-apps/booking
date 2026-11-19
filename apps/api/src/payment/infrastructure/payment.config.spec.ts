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
    delete process.env.STRIPE_STAND_IN_URL;
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

  it("talks to Stripe itself when no stand-in is named", () => {
    process.env.STRIPE_STAND_IN_URL = "";

    expect(loadPaymentConfig().standIn).toBeNull();
  });

  describe("with a stand-in", () => {
    beforeEach(() => {
      process.env.STRIPE_STAND_IN_URL = "http://127.0.0.1:3202";
    });

    it("sends the calls to it and keeps the secrets it is given", () => {
      const config = loadPaymentConfig();

      expect(config.standIn?.href).toBe("http://127.0.0.1:3202/");
      expect(config.paymentWebhookSecret).toBe("whsec_payment");
    });

    it("takes localhost as well as the loopback address", () => {
      process.env.STRIPE_STAND_IN_URL = "http://localhost:3202";

      expect(loadPaymentConfig().standIn?.hostname).toBe("localhost");
    });

    it("still requires the key and the webhook secret", () => {
      delete process.env.STRIPE_PAYMENT_WEBHOOK_SECRET;

      expect(() => loadPaymentConfig()).toThrow(
        "STRIPE_PAYMENT_WEBHOOK_SECRET",
      );
    });

    it("refuses to boot in production", () => {
      process.env.NODE_ENV = "production";
      process.env.STRIPE_PAYOUT_WEBHOOK_SECRET = "whsec_payout";

      expect(() => loadPaymentConfig()).toThrow("STRIPE_STAND_IN_URL");
    });

    it.each([
      "https://stand-in.example.com",
      "ftp://localhost",
      "127.0.0.1:3202",
      "http://127.0.0.1:3202/v1",
      "http://127.0.0.1:3202?mode=test",
      "http://user:secret@127.0.0.1:3202",
    ])("refuses %s, which is not an http origin on this machine", (value) => {
      process.env.STRIPE_STAND_IN_URL = value;

      expect(() => loadPaymentConfig()).toThrow("STRIPE_STAND_IN_URL");
    });
  });
});
