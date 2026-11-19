import Stripe from "stripe";
import { loadPaymentConfig } from "./payment.config";
import { createStripeClient } from "./stripe";

describe("createStripeClient with Stripe off", () => {
  const savedEnv = process.env;

  beforeAll(() => {
    process.env = { ...savedEnv, STRIPE_OFF: "true" };
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  it("refuses a call before it leaves the process, as an unreachable Stripe would", async () => {
    const stripe = createStripeClient(loadPaymentConfig());

    await expect(stripe.paymentIntents.retrieve("pi_1")).rejects.toThrow(
      Stripe.errors.StripeConnectionError,
    );
  });
});
