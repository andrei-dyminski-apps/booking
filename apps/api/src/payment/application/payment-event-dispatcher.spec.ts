import { Test } from "@nestjs/testing";
import { PaymentEventQueue } from "../infrastructure/payment-event.queue";
import { PaymentEventRepository } from "../infrastructure/payment-event.repository";
import { PaymentEventDispatcher } from "./payment-event-dispatcher";
import type { PaymentEventHandler } from "./payment-event-handler";
import type { PaymentEvent } from "./ports/payment-gateway";

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
type PublicOf<T> = { [K in keyof T]: T[K] };

class FakePaymentEventRepository implements PublicOf<PaymentEventRepository> {
  readonly rows = new Map<
    string,
    { event: PaymentEvent; receivedAt: Date; processed: boolean }
  >();

  record(event: PaymentEvent): Promise<void> {
    if (!this.rows.has(event.eventId)) {
      this.rows.set(event.eventId, {
        event,
        receivedAt: new Date(),
        processed: false,
      });
    }

    return Promise.resolve();
  }

  findUnprocessed(eventId: string): Promise<PaymentEvent | null> {
    const row = this.rows.get(eventId);

    return Promise.resolve(
      row === undefined || row.processed ? null : row.event,
    );
  }

  markProcessed(eventId: string): Promise<void> {
    const row = this.rows.get(eventId);

    if (row !== undefined) row.processed = true;

    return Promise.resolve();
  }

  findStale(before: Date): Promise<string[]> {
    return Promise.resolve(
      [...this.rows.entries()]
        .filter(([, row]) => !row.processed && row.receivedAt <= before)
        .map(([id]) => id),
    );
  }
}

class FakePaymentEventQueue implements PublicOf<PaymentEventQueue> {
  readonly queued: string[] = [];

  onApplicationBootstrap(): void {}

  process(eventId: string): Promise<void> {
    this.queued.push(eventId);

    return Promise.resolve();
  }
}

class RecordingHandler implements PaymentEventHandler {
  readonly seen: PaymentEvent[] = [];

  /** Set to have the handler fail, as a refund the provider cannot be asked for would. */
  failing = false;

  handle(event: PaymentEvent): Promise<void> {
    if (this.failing) return Promise.reject(new Error("api_connection_error"));

    this.seen.push(event);

    return Promise.resolve();
  }
}

const event = (eventId: string): PaymentEvent => ({
  kind: "other",
  eventId,
  type: "customer.created",
});

describe("PaymentEventDispatcher", () => {
  let dispatcher: PaymentEventDispatcher;
  let paymentEventRepository: FakePaymentEventRepository;
  let paymentEventQueue: FakePaymentEventQueue;
  let first: RecordingHandler;
  let second: RecordingHandler;

  beforeEach(async () => {
    paymentEventRepository = new FakePaymentEventRepository();
    paymentEventQueue = new FakePaymentEventQueue();
    first = new RecordingHandler();
    second = new RecordingHandler();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentEventDispatcher,
        { provide: PaymentEventRepository, useValue: paymentEventRepository },
        { provide: PaymentEventQueue, useValue: paymentEventQueue },
      ],
    }).compile();

    dispatcher = moduleRef.get(PaymentEventDispatcher);
    dispatcher.register(first);
    dispatcher.register(second);
  });

  it("records and queues a delivery without handling it", async () => {
    await dispatcher.receive(event("evt_1"));

    expect(paymentEventRepository.rows.has("evt_1")).toBe(true);
    expect(paymentEventQueue.queued).toEqual(["evt_1"]);
    expect(first.seen).toEqual([]);
  });

  it("hands a recorded event to every handler, then marks it processed", async () => {
    await dispatcher.receive(event("evt_1"));
    await dispatcher.process("evt_1");

    expect(first.seen).toEqual([event("evt_1")]);
    expect(second.seen).toEqual([event("evt_1")]);
    expect(paymentEventRepository.rows.get("evt_1")?.processed).toBe(true);
  });

  it("does the work of one event once, however often it arrives", async () => {
    await dispatcher.receive(event("evt_1"));
    await dispatcher.receive(event("evt_1"));
    await dispatcher.process("evt_1");
    await dispatcher.process("evt_1");

    expect(first.seen).toEqual([event("evt_1")]);
  });

  it("leaves an event unprocessed when a handler fails, so its job tries again", async () => {
    await dispatcher.receive(event("evt_1"));
    second.failing = true;

    await expect(dispatcher.process("evt_1")).rejects.toThrow();
    expect(paymentEventRepository.rows.get("evt_1")?.processed).toBe(false);

    second.failing = false;
    await dispatcher.process("evt_1");

    expect(paymentEventRepository.rows.get("evt_1")?.processed).toBe(true);
    expect(second.seen).toEqual([event("evt_1")]);
  });

  it("re-queues what a lost job left unprocessed, but not an event just in", async () => {
    await dispatcher.receive(event("evt_old"));
    await dispatcher.receive(event("evt_new"));
    await dispatcher.receive(event("evt_done"));
    await dispatcher.process("evt_done");

    const old = paymentEventRepository.rows.get("evt_old");

    if (old !== undefined) old.receivedAt = new Date(Date.now() - 120_000);
    paymentEventQueue.queued.length = 0;

    await expect(dispatcher.requeueStale()).resolves.toBe(1);
    expect(paymentEventQueue.queued).toEqual(["evt_old"]);
  });

  it("ignores an event it never recorded", async () => {
    await dispatcher.process("evt_unknown");

    expect(first.seen).toEqual([]);
  });
});
