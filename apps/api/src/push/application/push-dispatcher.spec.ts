import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  DEFAULT_PUSH_PREFERENCES,
  NotificationType,
  type Notification,
} from "@repo/contracts";
import {
  DisabledPushGateway,
  InMemoryPushGateway,
} from "../infrastructure/web-push.gateway";
import { PushOutboxRepository } from "../infrastructure/push-outbox.repository";
import { PushRepository } from "../infrastructure/push.repository";
import { MAX_DELIVERY_ATTEMPTS } from "../domain/push-policy";
import {
  FakePushOutboxRepository,
  FakePushRepository,
} from "../testing/push.fakes";
import { PushGateway } from "./ports/push-gateway";
import { MAX_TASK_FAILURES, PushDispatcher } from "./push-dispatcher";

const NOW = new Date("2026-07-01T21:30:00Z");
const ALICE = randomUUID();
const BOB = randomUUID();

const browser = (name: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  keys: { p256dh: "p256dh", auth: "auth" },
});

const notice = (
  type: Notification["type"] = NotificationType.BOOKING_REQUESTED,
) =>
  ({
    id: randomUUID(),
    type,
    data: {
      bookingId: randomUUID(),
      listingId: randomUUID(),
      listingTitle: "Loft above the harbour",
      from: "2026-09-01",
      to: "2026-09-05",
    },
    readAt: null,
    createdAt: NOW.toISOString(),
  }) as Notification;

describe("PushDispatcher", () => {
  let pushRepository: FakePushRepository;
  let outbox: FakePushOutboxRepository;
  let gateway: InMemoryPushGateway;

  const dispatcherWith = async (pushGateway: PushGateway) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PushDispatcher,
        { provide: PushRepository, useValue: pushRepository },
        { provide: PushOutboxRepository, useValue: outbox },
        { provide: PushGateway, useValue: pushGateway },
      ],
    }).compile();

    return moduleRef.get(PushDispatcher);
  };

  /** A notice to Alice, its task and the dispatcher's answer to it. */
  const noticeTask = (createdAt = NOW, type?: Notification["type"]) => {
    const written = notice(type);

    pushRepository.notices.set(written.id, { userId: ALICE, notice: written });
    outbox.addTask("notice", written.id, ALICE, createdAt);

    return written.id;
  };

  const taskClaim = (id: string) => ({
    id,
    generation: outbox.tasks.get(id)?.generation ?? 0,
  });

  const deliveryClaim = (id: string) => ({
    id,
    generation: outbox.deliveries.get(id)?.generation ?? 0,
  });

  const outcomeOf = (id: string) => outbox.tasks.get(id)?.outcome;

  beforeEach(async () => {
    jest.useFakeTimers({ now: NOW });
    pushRepository = new FakePushRepository();
    outbox = new FakePushOutboxRepository(pushRepository);
    gateway = new InMemoryPushGateway();
    await pushRepository.save(ALICE, browser("phone"));
    await pushRepository.save(ALICE, browser("laptop"));
    await pushRepository.save(BOB, browser("bob"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("deciding a task", () => {
    let dispatcher: PushDispatcher;

    beforeEach(async () => {
      dispatcher = await dispatcherWith(gateway);
    });

    it("fans a notice out to every browser of its account as durable deliveries", async () => {
      const id = noticeTask();

      await dispatcher.dispatch(taskClaim(id));

      expect(outcomeOf(id)).toBe("dispatched");
      const deliveries = [...outbox.deliveries.values()];
      expect(deliveries).toHaveLength(2);
      for (const delivery of deliveries) {
        await dispatcher.deliver(deliveryClaim(delivery.id));
      }
      expect(gateway.sent.map(({ payload }) => payload.receipt)).toEqual(
        deliveries.map(({ id }) => id),
      );
    });

    it("pushes a message to its recipient with the sender's current name", async () => {
      const id = randomUUID();
      const conversationId = randomUUID();

      const source = {
        conversationId,
        senderName: "Alice",
        listingTitle: "Loft",
        body: "Hello",
      };
      pushRepository.messages.set(id, { userId: BOB, source });
      outbox.addTask("message", id, BOB, NOW);

      await dispatcher.dispatch(taskClaim(id));

      source.senderName = "Deleted user";
      for (const delivery of outbox.deliveries.values()) {
        await dispatcher.deliver(deliveryClaim(delivery.id));
      }

      expect(gateway.sent.map(({ payload }) => payload)).toEqual([
        expect.objectContaining({
          tag: `conversation-${conversationId}`,
          body: "Hello",
          title: "Deleted user · Loft",
        }),
      ]);
    });

    it("drops news that was read meanwhile, or that is a day old", async () => {
      const read = randomUUID();
      outbox.addTask("notice", read, ALICE, NOW);
      const old = noticeTask(new Date("2026-06-30T21:30:00Z"));

      await dispatcher.dispatch(taskClaim(read));
      await dispatcher.dispatch(taskClaim(old));

      expect(outcomeOf(read)).toBe("read");
      expect(outcomeOf(old)).toBe("stale");
      expect(outbox.deliveries.size).toBe(0);
    });

    it("skips a muted group and waits out the quiet hours", async () => {
      await pushRepository.savePreferences(ALICE, {
        ...DEFAULT_PUSH_PREFERENCES,
        muted: ["reviews"],
        quietHours: { from: "21:00", to: "07:00", timeZone: "UTC" },
      });
      const muted = noticeTask(NOW, NotificationType.REVIEW_RECEIVED);
      const quiet = noticeTask();

      await dispatcher.dispatch(taskClaim(muted));
      await dispatcher.dispatch(taskClaim(quiet));

      expect(outcomeOf(muted)).toBe("muted");
      expect(outbox.tasks.get(quiet)).toMatchObject({
        outcome: null,
        availableAt: new Date("2026-07-02T07:00:00Z"),
      });
      expect(outbox.deliveries.size).toBe(0);
    });

    it("applies the current hourly limit at send time and shares it across devices", async () => {
      const ids = [noticeTask(), noticeTask(), noticeTask()];
      for (const id of ids) await dispatcher.dispatch(taskClaim(id));

      await pushRepository.savePreferences(ALICE, {
        ...DEFAULT_PUSH_PREFERENCES,
        hourlyLimit: 2,
      });
      for (const delivery of outbox.deliveries.values()) {
        await dispatcher.deliver(deliveryClaim(delivery.id));
      }

      expect(gateway.sent).toHaveLength(4);
      expect(ids.map(outcomeOf)).toEqual([
        "dispatched",
        "dispatched",
        "limited",
      ]);
    });

    it("counts a run that threw, and sets the task aside at the cap", async () => {
      const id = noticeTask();
      jest
        .spyOn(pushRepository, "preferencesOf")
        .mockRejectedValue(new Error("Database is down"));
      const error = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);

      for (let run = 1; run < MAX_TASK_FAILURES; run += 1) {
        jest.setSystemTime(new Date(NOW.getTime() + (run - 1) * 15_000));
        await expect(dispatcher.dispatch(taskClaim(id))).rejects.toThrow(
          "Database is down",
        );
      }

      expect(outcomeOf(id)).toBeNull();
      jest.setSystemTime(
        new Date(NOW.getTime() + (MAX_TASK_FAILURES - 1) * 15_000),
      );
      await expect(dispatcher.dispatch(taskClaim(id))).rejects.toThrow();
      expect(outcomeOf(id)).toBe("failed");
      expect(error).toHaveBeenCalledTimes(1);
      error.mockRestore();
    });
  });

  it("sends nothing while push is not configured", async () => {
    const dispatcher = await dispatcherWith(new DisabledPushGateway());
    const id = noticeTask();

    await dispatcher.dispatch(taskClaim(id));

    expect(outcomeOf(id)).toBe("off");
  });

  describe("sending a delivery", () => {
    let dispatcher: PushDispatcher;
    let deliveryId: string;
    const phone = browser("phone").endpoint;

    beforeEach(async () => {
      dispatcher = await dispatcherWith(gateway);
      await pushRepository.remove(ALICE, browser("laptop").endpoint);
      await dispatcher.dispatch(taskClaim(noticeTask()));
      [deliveryId = ""] = outbox.deliveries.keys();
    });

    const delivery = () => outbox.deliveries.get(deliveryId);

    it("records what the push service took", async () => {
      await dispatcher.deliver(deliveryClaim(deliveryId));

      expect(delivery()).toMatchObject({ status: "sent", responseStatus: 201 });
      expect(gateway.sent).toHaveLength(1);

      // A job handed out twice sends once.
      await dispatcher.deliver(deliveryClaim(deliveryId));
      expect(gateway.sent).toHaveLength(1);
    });

    it("forgets a browser its push service dropped", async () => {
      gateway.gone.add(phone);

      await dispatcher.deliver(deliveryClaim(deliveryId));

      expect(delivery()?.status).toBe("gone");
      expect(
        pushRepository.subscriptions.map(({ endpoint }) => endpoint),
      ).toEqual([browser("bob").endpoint]);
    });

    it("keeps a browser whose push service refused the VAPID credentials", async () => {
      gateway.script.set(phone, [{ kind: "forbidden", status: 403 }]);

      await dispatcher.deliver(deliveryClaim(deliveryId));

      expect(delivery()).toMatchObject({
        status: "rejected",
        responseStatus: 403,
      });
      expect(
        pushRepository.subscriptions.map(({ endpoint }) => endpoint),
      ).toContain(phone);
    });

    it("tries a push service that failed again later, and gives up at the cap", async () => {
      gateway.script.set(
        phone,
        Array.from({ length: MAX_DELIVERY_ATTEMPTS }, () => ({
          kind: "unavailable" as const,
          status: 503,
          reason: "503 Service Unavailable",
        })),
      );

      await dispatcher.deliver(deliveryClaim(deliveryId));
      expect(delivery()).toMatchObject({
        status: "pending",
        attempts: 1,
        availableAt: new Date("2026-07-01T21:30:15Z"),
      });

      const warn = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);

      for (let attempt = 2; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
        jest.setSystemTime(delivery()?.availableAt ?? NOW);
        await dispatcher.deliver(deliveryClaim(deliveryId));
      }

      expect(delivery()).toMatchObject({
        status: "failed",
        responseStatus: 503,
      });
      expect(gateway.sent).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it("waits for a throttling push service without counting the try", async () => {
      gateway.script.set(phone, [
        {
          kind: "throttled",
          status: 429,
          retryAfter: new Date("2026-07-01T21:40:00Z"),
        },
      ]);

      const firstJob = deliveryClaim(deliveryId);
      await dispatcher.deliver(firstJob);

      expect(delivery()).toMatchObject({
        status: "pending",
        attempts: 0,
        availableAt: new Date("2026-07-01T21:40:00Z"),
      });

      await dispatcher.deliver(firstJob);
      await dispatcher.deliver(deliveryClaim(deliveryId));
      expect(gateway.sent).toHaveLength(0);

      jest.setSystemTime(new Date("2026-07-01T21:40:00Z"));
      await dispatcher.deliver(firstJob);
      expect(gateway.sent).toHaveLength(0);
      await dispatcher.deliver(deliveryClaim(deliveryId));
      expect(delivery()?.status).toBe("sent");
    });

    it("rechecks the hourly limit when a retry crosses into a new window", async () => {
      await pushRepository.savePreferences(ALICE, {
        ...DEFAULT_PUSH_PREFERENCES,
        hourlyLimit: 1,
      });
      const retryAfter = new Date("2026-07-01T23:00:00Z");
      gateway.script.set(phone, [
        { kind: "throttled", status: 429, retryAfter },
      ]);
      await dispatcher.deliver(deliveryClaim(deliveryId));

      jest.setSystemTime(retryAfter);
      const fresh = noticeTask(retryAfter);
      await dispatcher.dispatch(taskClaim(fresh));
      for (const next of outbox.deliveries.values()) {
        if (next.taskId === fresh)
          await dispatcher.deliver(deliveryClaim(next.id));
      }
      await dispatcher.deliver(deliveryClaim(deliveryId));

      expect(gateway.sent).toHaveLength(1);
      expect(delivery()).toMatchObject({
        status: "skipped",
        lastError: "Hourly push limit reached",
      });
    });

    it("stops at a refusal for good, and at a browser unsubscribed since", async () => {
      gateway.script.set(phone, [
        { kind: "rejected", status: 413, reason: "413 Payload Too Large" },
      ]);

      await dispatcher.deliver(deliveryClaim(deliveryId));
      expect(delivery()).toMatchObject({
        status: "rejected",
        responseStatus: 413,
      });

      const second = noticeTask();
      await dispatcher.dispatch(taskClaim(second));
      const next = [...outbox.deliveries.values()].find(
        ({ taskId }) => taskId === second,
      );
      await pushRepository.remove(ALICE, phone);
      await dispatcher.deliver(deliveryClaim(next?.id ?? ""));

      expect(next?.status).toBe("gone");
    });

    it("lets a delivery that outlived the push go", async () => {
      jest.setSystemTime(new Date("2026-07-02T21:30:00Z"));

      await dispatcher.deliver(deliveryClaim(deliveryId));

      expect(delivery()?.status).toBe("expired");
      expect(gateway.sent).toEqual([]);
    });
  });
});
