import { BadRequestException, type RawBodyRequest } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Request } from "express";
import { PaymentEventDispatcher } from "../../payment/application/payment-event-dispatcher";
import { InvalidPaymentEventError } from "../../payment/application/ports/payment-gateway";
import {
  PayoutGateway,
  type AccountEvent,
} from "../application/ports/payout-gateway";
import { PayoutWebhookController } from "./payout-webhook.controller";

const EVENT: AccountEvent = {
  kind: "account",
  eventId: "evt_account",
  type: "v2.core.account[requirements].updated",
  accountId: "acct_host",
};

/** What the payment webhook's spec checks, for the deliveries about payout accounts. */
describe("PayoutWebhookController", () => {
  let controller: PayoutWebhookController;
  let read: () => AccountEvent;
  let handle: (event: AccountEvent) => Promise<void>;
  const handled: AccountEvent[] = [];

  const request = (rawBody: Buffer | undefined) =>
    ({ rawBody }) as RawBodyRequest<Request>;

  beforeEach(async () => {
    handled.length = 0;
    read = () => EVENT;
    handle = (event) => {
      handled.push(event);

      return Promise.resolve();
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [PayoutWebhookController],
      providers: [
        {
          provide: PayoutGateway,
          useValue: { readAccountEvent: () => read() },
        },
        {
          provide: PaymentEventDispatcher,
          useValue: { receive: (event: AccountEvent) => handle(event) },
        },
      ],
    }).compile();

    controller = moduleRef.get(PayoutWebhookController);
  });

  it("hands a verified account event to the inbox", async () => {
    await expect(
      controller.receive(request(Buffer.from("{}")), "t=1,v1=sig"),
    ).resolves.toEqual({ received: true });
    expect(handled).toEqual([EVENT]);
  });

  it("refuses an unsigned or forged delivery with a 400", async () => {
    await expect(
      controller.receive(request(Buffer.from("{}")), undefined),
    ).rejects.toBeInstanceOf(BadRequestException);

    read = () => {
      throw new InvalidPaymentEventError("no match");
    };

    await expect(
      controller.receive(request(Buffer.from("{}")), "t=1,v1=forged"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(handled).toEqual([]);
  });

  it("lets any other failure through, so the provider delivers again", async () => {
    handle = () => Promise.reject(new Error("Stripe could not be reached"));

    await expect(
      controller.receive(request(Buffer.from("{}")), "t=1,v1=sig"),
    ).rejects.toThrow("Stripe could not be reached");
  });
});
