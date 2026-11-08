import Stripe from "stripe";
import {
  RefundExceedsPaymentError,
  RefundRefusedError,
} from "../application/ports/payment-gateway";
import { cents } from "../domain/money";
import type { PaymentConfig } from "./payment.config";
import { STRIPE_API_VERSION } from "./stripe";
import { StripePaymentGateway } from "./stripe-payment.gateway";

const PAYMENT_ID = "pi_spec";
const KEY = "booking-1-adjustment-2";

const config: PaymentConfig = {
  secretKey: "sk_test_spec",
  paymentWebhookSecret: "whsec_spec",
  payoutWebhookSecret: "whsec_spec",
  site: "spec",
};

type Answer = { status: number; body: unknown };

/** A refund as Stripe answers one, with only the fields the adapter reads. */
const refundObject = (
  id: string,
  amount: number,
  key: string,
  status = "succeeded",
) => ({ id, object: "refund", amount, status, metadata: { key } });

/** A refusal in Stripe's error envelope. */
const refusal = (status: number, error: Record<string, string>): Answer => ({
  status,
  body: { error: { message: "Refused by the spec", ...error } },
});

/**
 * Stripe at the HTTP boundary and nowhere else: the SDK builds the requests and parses the
 * answers — its own error classes included — so what the adapter reads off a refusal is what
 * it would read off Stripe's. `refunds.create` answers from a queue; `refunds.list` from
 * `listings`, then with `listed`.
 */
class FakeStripeApi {
  readonly created: { idempotencyKey: string | null; form: URLSearchParams }[] =
    [];

  readonly creates: Answer[] = [];
  listed: unknown[] = [];
  /** How many times `refunds.list` was read. */
  lists = 0;
  /** What the next reads of `refunds.list` answer, one each, before `listed`. */
  readonly listings: unknown[][] = [];

  readonly fetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);

    if (init?.method === "POST" && url.pathname === "/v1/refunds") {
      const form = new URLSearchParams(
        typeof init.body === "string" ? init.body : "",
      );

      this.created.push({
        idempotencyKey: new Headers(init.headers).get("Idempotency-Key"),
        form,
      });

      const answer = this.creates.shift() ?? {
        status: 200,
        body: refundObject(
          `re_${String(this.created.length)}`,
          Number(form.get("amount")),
          form.get("metadata[key]") ?? "",
        ),
      };

      return Promise.resolve(respond(answer));
    }

    if (url.pathname === "/v1/refunds") {
      this.lists += 1;

      return Promise.resolve(
        respond({
          status: 200,
          body: {
            object: "list",
            data: this.listings.shift() ?? this.listed,
            has_more: false,
            url: "/v1/refunds",
          },
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

describe("StripePaymentGateway refunds", () => {
  let api: FakeStripeApi;
  let gateway: StripePaymentGateway;

  beforeEach(() => {
    api = new FakeStripeApi();
    gateway = new StripePaymentGateway(
      config,
      new Stripe(config.secretKey, {
        apiVersion: STRIPE_API_VERSION,
        httpClient: Stripe.createFetchHttpClient(api.fetch),
        maxNetworkRetries: 0,
        telemetry: false,
      }),
    );
  });

  describe("refundNow", () => {
    it("names the refund by its key and sends it under a key that carries the amount", async () => {
      await expect(
        gateway.refundNow(PAYMENT_ID, cents(5_000), KEY),
      ).resolves.toEqual({ id: "re_1", amount: 5_000 });

      const [sent] = api.created;

      expect(sent?.idempotencyKey).toBe(`${KEY}-5000`);
      expect(sent?.form.get("payment_intent")).toBe(PAYMENT_ID);
      expect(sent?.form.get("amount")).toBe("5000");
      expect(sent?.form.get("metadata[key]")).toBe(KEY);
    });

    it("reads Stripe's refusal of more than the charge has left as RefundExceedsPaymentError", async () => {
      api.creates.push(
        refusal(400, { type: "invalid_request_error", param: "amount" }),
        refusal(400, {
          type: "invalid_request_error",
          code: "charge_already_refunded",
        }),
      );

      await expect(
        gateway.refundNow(PAYMENT_ID, cents(5_000), KEY),
      ).rejects.toBeInstanceOf(RefundExceedsPaymentError);
      await expect(
        gateway.refundNow(PAYMENT_ID, cents(5_000), KEY),
      ).rejects.toBeInstanceOf(RefundExceedsPaymentError);
    });

    it("sends a lower amount after a refusal as a request of its own", async () => {
      api.creates.push(
        refusal(400, { type: "invalid_request_error", param: "amount" }),
      );

      await expect(
        gateway.refundNow(PAYMENT_ID, cents(5_000), KEY),
      ).rejects.toBeInstanceOf(RefundExceedsPaymentError);
      await expect(
        gateway.refundNow(PAYMENT_ID, cents(2_000), KEY),
      ).resolves.toMatchObject({ amount: 2_000 });
      expect(api.created.map((sent) => sent.idempotencyKey)).toEqual([
        `${KEY}-5000`,
        `${KEY}-2000`,
      ]);
    });

    it("passes a failure that leaves the outcome unknown on as it is", async () => {
      api.creates.push(refusal(500, { type: "api_error" }));

      const failure = gateway.refundNow(PAYMENT_ID, cents(5_000), KEY);

      await expect(failure).rejects.toBeInstanceOf(
        Stripe.errors.StripeAPIError,
      );
      await expect(failure).rejects.not.toBeInstanceOf(RefundRefusedError);
    });

    it("reads any other refusal of the request as RefundRefusedError, a disputed charge and another refusal of the amount included", async () => {
      api.creates.push(
        refusal(400, {
          type: "invalid_request_error",
          code: "charge_disputed",
          message:
            "Charge ch_spec has been charged back; cannot issue a refund.",
        }),
        refusal(400, {
          type: "invalid_request_error",
          param: "amount",
          code: "parameter_invalid_integer",
        }),
      );

      const disputed = gateway.refundNow(PAYMENT_ID, cents(5_000), KEY);

      await expect(disputed).rejects.toBeInstanceOf(RefundRefusedError);
      await expect(disputed).rejects.toMatchObject({
        reason: "Charge ch_spec has been charged back; cannot issue a refund.",
      });

      const invalid = gateway.refundNow(PAYMENT_ID, cents(5_000), KEY);

      await expect(invalid).rejects.toBeInstanceOf(RefundRefusedError);
      await expect(invalid).rejects.not.toBeInstanceOf(
        RefundExceedsPaymentError,
      );
    });

    it("reads Stripe's amount_too_large as RefundExceedsPaymentError too", async () => {
      api.creates.push(
        refusal(400, {
          type: "invalid_request_error",
          param: "amount",
          code: "amount_too_large",
        }),
      );

      await expect(
        gateway.refundNow(PAYMENT_ID, cents(5_000), KEY),
      ).rejects.toBeInstanceOf(RefundExceedsPaymentError);
    });

    it("passes a key in use on as an unknown outcome, not a refusal: the press's own request is still in flight under it", async () => {
      api.creates.push(
        refusal(409, {
          type: "invalid_request_error",
          code: "idempotency_key_in_use",
        }),
      );
      api.listed = [refundObject("re_raced", 5_000, KEY)];

      const inFlight = gateway.refundNow(PAYMENT_ID, cents(5_000), KEY);

      await expect(inFlight).rejects.toBeInstanceOf(
        Stripe.errors.StripeAPIError,
      );
      await expect(inFlight).rejects.not.toBeInstanceOf(RefundRefusedError);
      await expect(inFlight).rejects.not.toBeInstanceOf(
        RefundExceedsPaymentError,
      );
      expect(api.lists).toBe(0);
    });

    it("passes a key reused with other parameters on as it is, with no lookup", async () => {
      api.creates.push(refusal(400, { type: "idempotency_error" }));
      api.listed = [refundObject("re_raced", 5_000, KEY)];

      const reused = gateway.refundNow(PAYMENT_ID, cents(5_000), KEY);

      await expect(reused).rejects.toBeInstanceOf(
        Stripe.errors.StripeIdempotencyError,
      );
      await expect(reused).rejects.not.toBeInstanceOf(RefundRefusedError);
      expect(api.lists).toBe(0);
    });
  });

  describe("findRefunds", () => {
    it("finds the refund named by the key, past another key's and a cancelled one", async () => {
      api.listed = [
        refundObject("re_other", 1_000, "booking-1-cancellation"),
        refundObject("re_cancelled", 5_000, KEY, "canceled"),
        refundObject("re_sent", 5_000, KEY),
      ];

      await expect(gateway.findRefunds(PAYMENT_ID, KEY)).resolves.toEqual({
        refunded: 6_000,
        sent: { id: "re_sent", amount: 5_000 },
      });
    });

    it("counts what went back: pending refunds in, cancelled and failed ones out", async () => {
      api.listed = [
        refundObject("re_done", 1_000, "booking-1-cancellation"),
        refundObject("re_pending", 2_000, "dashboard", "pending"),
        refundObject("re_bounced", 4_000, "dashboard", "failed"),
        refundObject("re_cancelled", 8_000, "dashboard", "canceled"),
      ];

      await expect(gateway.findRefunds(PAYMENT_ID, KEY)).resolves.toEqual({
        refunded: 3_000,
        sent: null,
      });
    });

    it("still names a refund the bank sent back: it was sent", async () => {
      api.listed = [refundObject("re_bounced", 5_000, KEY, "failed")];

      await expect(gateway.findRefunds(PAYMENT_ID, KEY)).resolves.toEqual({
        refunded: 0,
        sent: { id: "re_bounced", amount: 5_000 },
      });
    });
  });

  it("keeps a cancellation's refund under its own key, the amount left out", async () => {
    await expect(
      gateway.refund(PAYMENT_ID, cents(5_000), "booking-1-cancellation"),
    ).resolves.toBe(5_000);
    expect(api.created[0]?.idempotencyKey).toBe("booking-1-cancellation");
  });

  it("answers a cancellation's key used with another amount by a racing run with the refund it sent", async () => {
    const key = "booking-1-cancellation";

    api.creates.push(refusal(400, { type: "idempotency_error" }));
    // The read before finds nothing yet; the one after the refusal finds the racing refund.
    api.listings.push([], [refundObject("re_raced", 4_000, key)]);

    await expect(gateway.refund(PAYMENT_ID, cents(5_000), key)).resolves.toBe(
      4_000,
    );
  });
});
