import { BadRequestException, type RawBodyRequest } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Request } from "express";
import { PaymentEventDispatcher } from "../application/payment-event-dispatcher";
import {
  InvalidPaymentEventError,
  PaymentGateway,
  type PaymentEvent,
} from "../application/ports/payment-gateway";
import { PaymentWebhookController } from "./payment-webhook.controller";

const EVENT: PaymentEvent = { kind: "other", eventId: "evt_1", type: "x" };

/**
 * The controller's half of the webhook is what its status codes mean to Stripe: a `400`
 * is never delivered again, anything else that fails is. So what has to hold is which
 * failure becomes which — the reading of the event is the adapter's and the e2e spec's.
 */
describe("PaymentWebhookController", () => {
  let controller: PaymentWebhookController;
  let read: (payload: Buffer, signature: string) => PaymentEvent;
  const dispatched: PaymentEvent[] = [];
  let dispatch: (event: PaymentEvent) => Promise<void>;

  const request = (rawBody: Buffer | undefined) =>
    ({ rawBody }) as RawBodyRequest<Request>;

  beforeEach(async () => {
    dispatched.length = 0;
    read = () => EVENT;
    dispatch = (event) => {
      dispatched.push(event);

      return Promise.resolve();
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentWebhookController],
      providers: [
        {
          provide: PaymentGateway,
          useValue: {
            readEvent: (payload: Buffer, signature: string) =>
              read(payload, signature),
          },
        },
        {
          provide: PaymentEventDispatcher,
          useValue: { receive: (event: PaymentEvent) => dispatch(event) },
        },
      ],
    }).compile();

    controller = moduleRef.get(PaymentWebhookController);
  });

  it("hands a verified event to the inbox", async () => {
    await expect(
      controller.receive(request(Buffer.from("{}")), "t=1,v1=sig"),
    ).resolves.toEqual({ received: true });
    expect(dispatched).toEqual([EVENT]);
  });

  it("refuses a delivery with no signature or no raw body, as one never to repeat", async () => {
    await expect(
      controller.receive(request(Buffer.from("{}")), undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.receive(request(undefined), "t=1,v1=sig"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dispatched).toEqual([]);
  });

  it("answers a forged signature with a 400", async () => {
    read = () => {
      throw new InvalidPaymentEventError("no match");
    };

    await expect(
      controller.receive(request(Buffer.from("{}")), "t=1,v1=forged"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dispatched).toEqual([]);
  });

  it("lets any other failure through, so the provider delivers again", async () => {
    dispatch = () => Promise.reject(new Error("database down"));

    await expect(
      controller.receive(request(Buffer.from("{}")), "t=1,v1=sig"),
    ).rejects.toThrow("database down");

    read = () => {
      throw new Error("unexpected");
    };

    await expect(
      controller.receive(request(Buffer.from("{}")), "t=1,v1=sig"),
    ).rejects.not.toBeInstanceOf(BadRequestException);
  });
});
