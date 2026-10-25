import { Test } from "@nestjs/testing";
import type { StayNotice } from "@repo/contracts";
import { StayLifecycle } from "../../booking/application/stay-lifecycle";
import { PaymentEventDispatcher } from "../../payment/application/payment-event-dispatcher";
import type { PaymentEvent } from "../../payment/application/ports/payment-gateway";
import { PayoutEventHandler } from "./payout-event-handler";
import { PayoutService, type SettlementEvent } from "./payout.service";

/**
 * Only what the handler hands the payout service: what the service does with each call is
 * `payout.service.spec.ts`'s.
 */
class FakePayoutService implements Pick<
  PayoutService,
  "schedule" | "settle" | "handleSettlementEvent"
> {
  readonly scheduled: string[] = [];
  readonly settled: string[] = [];
  readonly events: SettlementEvent[] = [];

  schedule(stay: { bookingId: string }): Promise<void> {
    this.scheduled.push(stay.bookingId);

    return Promise.resolve();
  }

  settle(bookingId: string): Promise<number | null> {
    this.settled.push(bookingId);

    return Promise.resolve(null);
  }

  handleSettlementEvent(event: SettlementEvent): Promise<void> {
    this.events.push(event);

    return Promise.resolve();
  }
}

const stay: StayNotice = {
  bookingId: "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b",
  listingId: "3a4b5c6d-7e8f-4091-8a2b-3c4d5e6f7a8b",
  listingTitle: "Loft above the harbour",
  from: "2099-01-10",
  to: "2099-01-13",
};

describe("PayoutEventHandler", () => {
  let handler: PayoutEventHandler;
  let payoutService: FakePayoutService;
  let registered: unknown[];
  let stayLifecycle: StayLifecycle;

  beforeEach(async () => {
    payoutService = new FakePayoutService();
    registered = [];

    const moduleRef = await Test.createTestingModule({
      providers: [
        PayoutEventHandler,
        StayLifecycle,
        { provide: PayoutService, useValue: payoutService },
        {
          provide: PaymentEventDispatcher,
          useValue: { register: (found: unknown) => registered.push(found) },
        },
      ],
    }).compile();

    handler = moduleRef.get(PayoutEventHandler);
    stayLifecycle = moduleRef.get(StayLifecycle);
    handler.onModuleInit();
  });

  it("registers with the payment dispatcher", () => {
    expect(registered).toEqual([handler]);
  });

  it("hands a dispute to the payout service, and nothing else — a refund included", async () => {
    const refunded: PaymentEvent = {
      kind: "refunded",
      eventId: "evt_refund",
      type: "charge.refunded",
      paymentId: "pi_1",
      chargeId: "ch_1",
      amountRefunded: 100,
    };
    const disputed: PaymentEvent = {
      kind: "disputed",
      eventId: "evt_dispute",
      type: "charge.dispute.created",
      paymentId: "pi_1",
    };
    const closed: PaymentEvent = {
      kind: "disputeClosed",
      eventId: "evt_closed",
      type: "charge.dispute.closed",
      paymentId: "pi_1",
      won: true,
    };

    await handler.handle(refunded);
    await handler.handle(disputed);
    await handler.handle(closed);
    await handler.handle({
      kind: "succeeded",
      eventId: "evt_paid",
      type: "payment_intent.succeeded",
      paymentId: "pi_1",
      chargeId: "ch_1",
      bookingId: stay.bookingId,
      amount: 480,
    });
    await handler.handle({ kind: "other", eventId: "evt_x", type: "x" });

    expect(payoutService.events).toEqual([disputed, closed]);
  });

  it("schedules the payout of a stay the booking side confirms", async () => {
    await stayLifecycle.confirmed(stay);

    expect(payoutService.scheduled).toEqual([stay.bookingId]);
  });

  it("takes the host's share of a refund the booking side announces", async () => {
    await stayLifecycle.refunded(stay.bookingId);

    expect(payoutService.settled).toEqual([stay.bookingId]);
  });
});
