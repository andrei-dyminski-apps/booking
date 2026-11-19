import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { PaymentConfig } from "./payment.config";
import { createStripeClient } from "./stripe";

describe("createStripeClient with a stand-in", () => {
  let server: Server;
  const received: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      received.push(`${request.method ?? ""} ${request.url ?? ""}`);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          id: "pi_1",
          object: "payment_intent",
          status: "succeeded",
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
  });

  // The SDK keeps its connection alive, which `close` alone would wait on.
  afterAll(async () => {
    const closed = once(server, "close");

    server.close();
    server.closeAllConnections();
    await closed;
  });

  it("sends a call to the stand-in instead of Stripe", async () => {
    const { port } = server.address() as AddressInfo;
    const config: PaymentConfig = {
      standIn: new URL(`http://127.0.0.1:${String(port)}`),
      secretKey: "sk_test_spec",
      paymentWebhookSecret: "whsec_spec",
      payoutWebhookSecret: "whsec_spec",
      site: "spec",
    };

    const intent =
      await createStripeClient(config).paymentIntents.retrieve("pi_1");

    expect(intent.status).toBe("succeeded");
    expect(received).toEqual(["GET /v1/payment_intents/pi_1"]);
  });
});
