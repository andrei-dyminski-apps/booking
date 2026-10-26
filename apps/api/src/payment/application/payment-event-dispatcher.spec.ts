import { Test } from "@nestjs/testing";
import { NotificationType, type NotificationContent } from "@repo/contracts";
import { subDays } from "date-fns";
import { NotificationService } from "../../notification/notification.service";
import { PaymentEventRepository } from "../infrastructure/payment-event.repository";
import {
  EVENT_RETENTION_DAYS,
  MAX_EVENT_ATTEMPTS,
  PaymentEventDispatcher,
  SWEEP_BATCH,
} from "./payment-event-dispatcher";
import {
  PaymentEventBusyError,
  type PaymentEventHandler,
} from "./payment-event-handler";
import { PaymentEventJobs } from "./ports/payment-event-jobs";
import type { PaymentEvent } from "./ports/payment-gateway";

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
type PublicOf<T> = { [K in keyof T]: T[K] };

type StoredEvent = {
  event: PaymentEvent;
  receivedAt: Date;
  processedAt: Date | null;
  attempts: number;
  lastError: string | null;
  setAside: boolean;
};

class FakePaymentEventRepository implements PublicOf<PaymentEventRepository> {
  readonly rows = new Map<string, StoredEvent>();

  record(event: PaymentEvent): Promise<void> {
    if (!this.rows.has(event.eventId)) {
      this.rows.set(event.eventId, {
        event,
        receivedAt: new Date(),
        processedAt: null,
        attempts: 0,
        lastError: null,
        setAside: false,
      });
    }

    return Promise.resolve();
  }

  findUnprocessed(eventId: string): Promise<PaymentEvent | null> {
    const row = this.pending(eventId);

    return Promise.resolve(row === undefined ? null : row.event);
  }

  markProcessed(eventId: string): Promise<void> {
    const row = this.pending(eventId);

    if (row !== undefined) row.processedAt = new Date();

    return Promise.resolve();
  }

  recordFailure(
    eventId: string,
    error: string,
    maxAttempts: number,
  ): Promise<{ type: string; attempts: number; setAside: boolean } | null> {
    const row = this.pending(eventId);

    if (row === undefined) return Promise.resolve(null);

    row.attempts += 1;
    row.lastError = error;
    row.setAside = row.attempts >= maxAttempts;

    return Promise.resolve({
      type: row.event.type,
      attempts: row.attempts,
      setAside: row.setAside,
    });
  }

  findStale(before: Date, limit: number): Promise<string[]> {
    return Promise.resolve(
      [...this.rows.entries()]
        .filter(
          ([, row]) =>
            row.processedAt === null &&
            !row.setAside &&
            row.receivedAt <= before,
        )
        .sort(([, a], [, b]) => a.receivedAt.getTime() - b.receivedAt.getTime())
        .slice(0, limit)
        .map(([id]) => id),
    );
  }

  pruneProcessed(before: Date): Promise<number> {
    let pruned = 0;

    for (const [id, row] of this.rows) {
      if (row.processedAt !== null && row.processedAt < before) {
        this.rows.delete(id);
        pruned += 1;
      }
    }

    return Promise.resolve(pruned);
  }

  /** Neither processed nor set aside, the condition every real query carries. */
  private pending(eventId: string): StoredEvent | undefined {
    const row = this.rows.get(eventId);

    return row === undefined || row.processedAt !== null || row.setAside
      ? undefined
      : row;
  }
}

class FakePaymentEventJobs implements PublicOf<PaymentEventJobs> {
  readonly queued: string[] = [];

  process(eventId: string): Promise<void> {
    this.queued.push(eventId);

    return Promise.resolve();
  }
}

/** Only the admins' half: who is told about an event set aside is asserted, not how. */
class FakeNotificationService implements Pick<
  NotificationService,
  "notifyAdmins"
> {
  readonly toAdmins: NotificationContent[] = [];

  notifyAdmins(content: NotificationContent): Promise<void> {
    this.toAdmins.push(content);

    return Promise.resolve();
  }
}

class RecordingHandler implements PaymentEventHandler {
  readonly seen: PaymentEvent[] = [];

  /** Set to have the handler fail, as a refund the provider cannot be asked for would. */
  failing = false;

  /** Set to have the handler find its stay held by another run, as a cancellation would. */
  busy = false;

  handle(event: PaymentEvent): Promise<void> {
    if (this.failing) return Promise.reject(new Error("api_connection_error"));

    if (this.busy) {
      return Promise.reject(new PaymentEventBusyError("held by another run"));
    }

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
  let paymentEventJobs: FakePaymentEventJobs;
  let notificationService: FakeNotificationService;
  let first: RecordingHandler;
  let second: RecordingHandler;

  beforeEach(async () => {
    paymentEventRepository = new FakePaymentEventRepository();
    paymentEventJobs = new FakePaymentEventJobs();
    notificationService = new FakeNotificationService();
    first = new RecordingHandler();
    second = new RecordingHandler();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentEventDispatcher,
        { provide: PaymentEventRepository, useValue: paymentEventRepository },
        { provide: PaymentEventJobs, useValue: paymentEventJobs },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    dispatcher = moduleRef.get(PaymentEventDispatcher);
    dispatcher.register(first);
    dispatcher.register(second);
  });

  it("records and queues a delivery without handling it", async () => {
    await dispatcher.receive(event("evt_1"));

    expect(paymentEventRepository.rows.has("evt_1")).toBe(true);
    expect(paymentEventJobs.queued).toEqual(["evt_1"]);
    expect(first.seen).toEqual([]);
  });

  it("hands a recorded event to every handler, then marks it processed", async () => {
    await dispatcher.receive(event("evt_1"));
    await dispatcher.process("evt_1");

    expect(first.seen).toEqual([event("evt_1")]);
    expect(second.seen).toEqual([event("evt_1")]);
    expect(
      paymentEventRepository.rows.get("evt_1")?.processedAt,
    ).not.toBeNull();
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
    expect(paymentEventRepository.rows.get("evt_1")?.processedAt).toBeNull();

    second.failing = false;
    await dispatcher.process("evt_1");

    expect(
      paymentEventRepository.rows.get("evt_1")?.processedAt,
    ).not.toBeNull();
    expect(second.seen).toEqual([event("evt_1")]);
  });

  it("re-queues what a lost job left unprocessed, but not an event just in", async () => {
    await dispatcher.receive(event("evt_old"));
    await dispatcher.receive(event("evt_new"));
    await dispatcher.receive(event("evt_done"));
    await dispatcher.process("evt_done");

    const old = paymentEventRepository.rows.get("evt_old");

    if (old !== undefined) old.receivedAt = new Date(Date.now() - 120_000);
    paymentEventJobs.queued.length = 0;

    await expect(dispatcher.requeueStale()).resolves.toBe(1);
    expect(paymentEventJobs.queued).toEqual(["evt_old"]);
  });

  it("retries an event whose stay another run holds without counting a failure", async () => {
    await dispatcher.receive(event("evt_1"));
    second.busy = true;

    for (let run = 0; run < MAX_EVENT_ATTEMPTS; run += 1) {
      await expect(dispatcher.process("evt_1")).rejects.toBeInstanceOf(
        PaymentEventBusyError,
      );
    }

    expect(paymentEventRepository.rows.get("evt_1")).toMatchObject({
      attempts: 0,
      setAside: false,
      processedAt: null,
    });
    expect(notificationService.toAdmins).toEqual([]);

    second.busy = false;
    await dispatcher.process("evt_1");

    expect(
      paymentEventRepository.rows.get("evt_1")?.processedAt,
    ).not.toBeNull();
  });

  it("counts every failed run on the event, with what it failed with", async () => {
    await dispatcher.receive(event("evt_1"));
    second.failing = true;

    await expect(dispatcher.process("evt_1")).rejects.toThrow();
    await expect(dispatcher.process("evt_1")).rejects.toThrow();

    expect(paymentEventRepository.rows.get("evt_1")).toMatchObject({
      attempts: 2,
      lastError: "Error: api_connection_error",
    });
    expect(notificationService.toAdmins).toEqual([]);
  });

  it("sets an event aside after its last allowed failure, tells the admins once and stops retrying", async () => {
    await dispatcher.receive(event("evt_poison"));
    second.failing = true;

    for (let run = 1; run < MAX_EVENT_ATTEMPTS; run += 1) {
      await expect(dispatcher.process("evt_poison")).rejects.toThrow();
    }

    // The last one completes the job instead of throwing: there is nothing left to retry.
    await expect(dispatcher.process("evt_poison")).resolves.toBeUndefined();

    expect(notificationService.toAdmins).toEqual([
      {
        type: NotificationType.PAYMENT_EVENT_FAILED,
        data: {
          eventId: "evt_poison",
          eventType: "customer.created",
          error: "Error: api_connection_error",
        },
      },
    ]);

    // Set aside, it is neither handled again nor swept back onto the queue.
    second.failing = false;
    await dispatcher.process("evt_poison");
    expect(second.seen).toEqual([]);

    const row = paymentEventRepository.rows.get("evt_poison");

    if (row !== undefined) row.receivedAt = new Date(Date.now() - 120_000);
    paymentEventJobs.queued.length = 0;

    await expect(dispatcher.requeueStale()).resolves.toBe(0);
    expect(notificationService.toAdmins).toHaveLength(1);
  });

  it("re-queues at most one batch per sweep, the oldest first", async () => {
    const past = Date.now() - 120_000;

    for (let index = 0; index <= SWEEP_BATCH; index += 1) {
      await dispatcher.receive(event(`evt_${String(index)}`));

      const row = paymentEventRepository.rows.get(`evt_${String(index)}`);

      if (row !== undefined) row.receivedAt = new Date(past + index);
    }
    paymentEventJobs.queued.length = 0;

    await expect(dispatcher.requeueStale()).resolves.toBe(SWEEP_BATCH);
    expect(paymentEventJobs.queued[0]).toBe("evt_0");
    expect(paymentEventJobs.queued).not.toContain(`evt_${String(SWEEP_BATCH)}`);
  });

  it("prunes the processed events past their retention and keeps the rest", async () => {
    await dispatcher.receive(event("evt_old"));
    await dispatcher.receive(event("evt_recent"));
    await dispatcher.receive(event("evt_pending"));
    await dispatcher.process("evt_old");
    await dispatcher.process("evt_recent");

    const old = paymentEventRepository.rows.get("evt_old");
    const now = new Date();

    if (old !== undefined) {
      old.processedAt = subDays(now, EVENT_RETENTION_DAYS + 1);
    }

    await expect(dispatcher.pruneProcessed(now)).resolves.toBe(1);
    expect([...paymentEventRepository.rows.keys()]).toEqual([
      "evt_recent",
      "evt_pending",
    ]);
  });

  it("ignores an event it never recorded", async () => {
    await dispatcher.process("evt_unknown");

    expect(first.seen).toEqual([]);
  });
});
