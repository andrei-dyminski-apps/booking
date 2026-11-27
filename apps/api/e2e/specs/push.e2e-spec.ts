import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { tz } from "@date-fns/tz";
import { addHours, format, subHours } from "date-fns";
import request from "supertest";
import { App } from "supertest/types";
import {
  DEFAULT_PUSH_PREFERENCES,
  Role,
  pushConfigSchema,
  pushPreferencesSchema,
  type CreateListingInput,
  type PushSubscriptionInput,
} from "@repo/contracts";
import { AppModule } from "../../src/app.module";
import { cents } from "../../src/payment/domain/money";
import { PrismaService } from "../../src/prisma/prisma.service";
import { PushGateway } from "../../src/push/application/ports/push-gateway";
import { PushDispatcher } from "../../src/push/application/push-dispatcher";
import { pushExpiresAt } from "../../src/push/domain/push-policy";
import { PushOutboxRepository } from "../../src/push/infrastructure/push-outbox.repository";
import { PushProcessor } from "../../src/push/infrastructure/push.processor";
import {
  MAX_PUSH_SUBSCRIPTIONS,
  pushEndpointHash,
} from "../../src/push/infrastructure/push.repository";
import { InMemoryPushGateway } from "../../src/push/infrastructure/web-push.gateway";
import { hasCode, issueCodesOf } from "../support/api-error";
import { resetDatabase } from "../support/database";
import { inDays } from "../support/dates";
import { resetQueue } from "../support/queue";
import {
  hostCredentials,
  signIn,
  signInAs,
  type Agent,
} from "../support/session";
import { waitUntil } from "../support/wait-until";

const listingInput: CreateListingInput = {
  title: "Loft above the harbour",
  description: "Two rooms under the roof and a wall of glass facing the water.",
  pricePerNightCents: cents(12_000),
  capacity: 4,
};

const browser = (name: string): PushSubscriptionInput => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  keys: {
    p256dh:
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
});

describe("Push (e2e)", () => {
  let app: INestApplication<App>;
  let gateway: InMemoryPushGateway;
  let guest: Agent;
  let owner: Agent;
  let listingId: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    await resetDatabase(app);
    await resetQueue(app);

    const pushGateway = app.get(PushGateway);

    if (!(pushGateway instanceof InMemoryPushGateway)) {
      throw new Error("The e2e specs push through the in-memory gateway");
    }

    gateway = pushGateway;
    guest = await signInAs(app, Role.USER);
    owner = await signIn(app, hostCredentials);

    const listing = await owner
      .post("/listings")
      .send(listingInput)
      .expect(201);

    listingId = (listing.body as { id: string }).id;
  });

  afterEach(async () => {
    await app.close();
  });

  const pushedTo = (name: string) =>
    gateway.sent.filter(({ endpoint }) => endpoint === browser(name).endpoint);

  const requestBooking = () =>
    guest
      .post("/bookings")
      .send({ listingId, from: inDays(10), to: inDays(12) })
      .expect(201);

  /** The host's one task, once it has an outcome. */
  const settledTask = async () => {
    const prismaService = app.get(PrismaService);
    let outcome: string | null = null;

    await waitUntil(async () => {
      const task = await prismaService.pushTask.findFirst({
        where: { outcome: { not: null } },
      });
      outcome = task?.outcome ?? null;

      return task !== null;
    });

    return outcome;
  };

  it("tells a stranger the key a browser subscribes with", async () => {
    const response = await request(app.getHttpServer())
      .get("/push/config")
      .expect(200);

    expect(pushConfigSchema.parse(response.body)).toEqual({
      publicKey: gateway.publicKey,
    });
  });

  it("refuses an endpoint that is not a push service's, and a stranger", async () => {
    const refused = await guest
      .post("/push/subscriptions")
      .send({ ...browser("x"), endpoint: "https://127.0.0.1/push" })
      .expect(400);

    expect(issueCodesOf(refused)).toEqual(["PUSH_ENDPOINT_INVALID"]);

    await request(app.getHttpServer())
      .post("/push/subscriptions")
      .send(browser("x"))
      .expect(401)
      .expect(hasCode("UNAUTHORIZED"));
  });

  it("pushes a host's notice to the host's browser, worded as the bell words it", async () => {
    await owner.post("/push/subscriptions").send(browser("host")).expect(204);
    await guest.post("/push/subscriptions").send(browser("guest")).expect(204);

    await guest
      .post("/bookings")
      .send({ listingId, from: inDays(10), to: inDays(12) })
      .expect(201);

    await waitUntil(() => Promise.resolve(pushedTo("host").length > 0));

    expect(pushedTo("host")[0]?.payload).toMatchObject({
      title: "New booking request",
      body: expect.stringContaining(listingInput.title) as string,
    });
    expect(pushedTo("guest")).toEqual([]);
  });

  it("pushes a message to the side that did not write it", async () => {
    await owner.post("/push/subscriptions").send(browser("host")).expect(204);
    await guest.post("/push/subscriptions").send(browser("guest")).expect(204);

    const started = await guest
      .post("/conversations")
      .send({ listingId, body: "Is the loft free in May?" })
      .expect(201);
    const conversationId = (started.body as { id: string }).id;

    await waitUntil(() => Promise.resolve(pushedTo("host").length > 0));

    expect(pushedTo("host")[0]?.payload).toMatchObject({
      body: "Is the loft free in May?",
      url: `/messages/${conversationId}`,
    });
    expect(pushedTo("guest")).toEqual([]);
  });

  it("enforces one hourly slot per push across all subscribed browsers", async () => {
    for (const name of ["phone", "laptop"]) {
      await owner.post("/push/subscriptions").send(browser(name)).expect(204);
    }
    await owner
      .patch("/push/settings")
      .send({ ...DEFAULT_PUSH_PREFERENCES, hourlyLimit: 1 })
      .expect(204);

    for (const body of ["First message", "Second message"]) {
      await guest.post("/conversations").send({ listingId, body }).expect(201);
    }

    const prismaService = app.get(PrismaService);
    await waitUntil(async () => {
      const pending = await prismaService.pushDelivery.count({
        where: { status: "pending" },
      });
      return pending === 0 && (await prismaService.pushDelivery.count()) === 4;
    });

    expect(pushedTo("phone")).toHaveLength(1);
    expect(pushedTo("laptop")).toHaveLength(1);
    expect(pushedTo("phone")[0]?.payload.body).toBe(
      pushedTo("laptop")[0]?.payload.body,
    );
    expect(
      await prismaService.pushTask.count({ where: { outcome: "limited" } }),
    ).toBe(1);
  });

  it("stops pushing to a browser that unsubscribed, or that its push service dropped", async () => {
    await owner.post("/push/subscriptions").send(browser("left")).expect(204);
    await owner
      .post("/push/subscriptions")
      .send(browser("cleared"))
      .expect(204);
    await owner.post("/push/subscriptions").send(browser("kept")).expect(204);
    await owner
      .delete("/push/subscriptions")
      .send({ endpoint: browser("left").endpoint })
      .expect(204);
    gateway.gone.add(browser("cleared").endpoint);

    await guest
      .post("/bookings")
      .send({ listingId, from: inDays(10), to: inDays(12) })
      .expect(201);

    await waitUntil(() => Promise.resolve(pushedTo("kept").length > 0));

    expect(pushedTo("left")).toEqual([]);
    const endpoints = await app
      .get(PrismaService)
      .pushSubscription.findMany({ select: { endpoint: true } });
    expect(endpoints).toEqual([{ endpoint: browser("kept").endpoint }]);
  });

  it("requires a fresh endpoint for another account and keeps the newest subscriptions", async () => {
    await guest.post("/push/subscriptions").send(browser("shared")).expect(204);
    const sharedAlias = {
      ...browser("shared"),
      endpoint: "https://FCM.GOOGLEAPIS.COM:443/fcm/send/shared",
    };
    await owner
      .post("/push/subscriptions")
      .send(sharedAlias)
      .expect(409)
      .expect(hasCode("PUSH_SUBSCRIPTION_REUSE"));
    await guest.post("/push/subscriptions").send(sharedAlias).expect(204);
    await guest
      .delete("/push/subscriptions")
      .send({ endpoint: sharedAlias.endpoint })
      .expect(204);
    await owner
      .post("/push/subscriptions")
      .send(browser("shared"))
      .expect(409)
      .expect(hasCode("PUSH_SUBSCRIPTION_REUSE"));
    await owner.post("/push/subscriptions").send(browser("fresh")).expect(204);

    for (let index = 0; index < MAX_PUSH_SUBSCRIPTIONS; index += 1) {
      await owner
        .post("/push/subscriptions")
        .send(browser(`device-${String(index)}`))
        .expect(204);
    }

    const rows = await app.get(PrismaService).pushSubscription.findMany({
      select: { endpoint: true },
    });
    expect(rows).toHaveLength(MAX_PUSH_SUBSCRIPTIONS);
    expect(rows).not.toContainEqual({ endpoint: browser("fresh").endpoint });
  });

  it("uses the devices present when the push was recorded", async () => {
    await owner
      .post("/push/subscriptions")
      .send(browser("original"))
      .expect(204);
    const { worker } = app.get(PushProcessor);
    await worker.pause();

    try {
      await requestBooking();
      await owner
        .post("/push/subscriptions")
        .send(browser("original"))
        .expect(204);
      await owner.post("/push/subscriptions").send(browser("new")).expect(204);
    } finally {
      await worker.resume();
    }

    await waitUntil(() => Promise.resolve(pushedTo("original").length > 0));
    expect(await app.get(PrismaService).pushDelivery.count()).toBe(1);
    expect(pushedTo("new")).toEqual([]);
  });

  it("writes no task for an account with no browser to push to", async () => {
    await requestBooking();

    await expect(app.get(PrismaService).pushTask.count()).resolves.toBe(0);
  });

  it("saves the account's preferences and refuses a window of no length", async () => {
    await owner
      .get("/push/settings")
      .expect(200)
      .expect(({ body }) => {
        expect(pushPreferencesSchema.parse(body)).toEqual(
          DEFAULT_PUSH_PREFERENCES,
        );
      });

    const preferences = {
      muted: ["reviews", "alerts"],
      quietHours: { from: "22:30", to: "06:00", timeZone: "Europe/Berlin" },
      hourlyLimit: 4,
    };

    await owner.patch("/push/settings").send(preferences).expect(204);
    await owner
      .get("/push/settings")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(preferences);
      });

    const refused = await owner
      .patch("/push/settings")
      .send({
        ...preferences,
        quietHours: { from: "08:00", to: "08:00", timeZone: "UTC" },
      })
      .expect(400);
    expect(issueCodesOf(refused)).toEqual(["PUSH_QUIET_HOURS_INVALID"]);
  });

  it("does not push a group the account muted", async () => {
    await owner.post("/push/subscriptions").send(browser("host")).expect(204);
    await owner
      .patch("/push/settings")
      .send({ ...DEFAULT_PUSH_PREFERENCES, muted: ["stays"] })
      .expect(204);

    await requestBooking();

    await expect(settledTask()).resolves.toBe("muted");
    expect(gateway.sent).toEqual([]);
  });

  it("honors Retry-After across tasks for one endpoint and keeps the 429 on expiry", async () => {
    const phone = browser("phone");
    await owner.post("/push/subscriptions").send(phone).expect(204);
    await owner.post("/push/subscriptions").send(browser("laptop")).expect(204);

    const { worker } = app.get(PushProcessor);
    const db = app.get(PrismaService);
    const outbox = app.get(PushOutboxRepository);
    const dispatcher = app.get(PushDispatcher);
    await worker.pause();
    try {
      await requestBooking();
      const original = await db.pushTask.findFirstOrThrow();
      const first = await db.pushTask.update({
        where: { id: original.id },
        data: { createdAt: subHours(new Date(), 23) },
      });
      await guest
        .post("/bookings")
        .send({ listingId, from: inDays(15), to: inDays(17) })
        .expect(201);
      const second = await db.pushTask.findFirstOrThrow({
        where: { id: { not: first.id } },
      });
      await outbox.fanOut(first, first.generation, "stays");
      await outbox.fanOut(second, second.generation, "stays");

      const deliveryTo = (taskId: string, endpoint: string) =>
        db.pushDelivery.findFirstOrThrow({
          where: { taskId, subscription: { endpoint } },
        });

      const throttled = await deliveryTo(first.id, phone.endpoint);
      const sameEndpoint = await deliveryTo(second.id, phone.endpoint);
      const otherEndpoint = await deliveryTo(
        second.id,
        browser("laptop").endpoint,
      );
      const retryAfter = addHours(new Date(), 2);
      gateway.script.set(phone.endpoint, [
        { kind: "throttled", status: 429, retryAfter },
      ]);

      await dispatcher.deliver(throttled);
      await dispatcher.deliver(sameEndpoint);
      await dispatcher.deliver(otherEndpoint);
      await expect(deliveryTo(first.id, phone.endpoint)).resolves.toMatchObject(
        {
          availableAt: pushExpiresAt(first.createdAt),
          attempts: 0,
          responseStatus: 429,
        },
      );
      // The pause is a duration added to the database's clock, so it lands within a moment of
      // the header's date, and every delivery to the endpoint waits for the same hold.
      const waiting = await deliveryTo(second.id, phone.endpoint);
      expect(waiting).toMatchObject({ status: "pending", attempts: 0 });
      expect(
        Math.abs(waiting.availableAt.getTime() - retryAfter.getTime()),
      ).toBeLessThan(1000);
      await expect(
        db.pushEndpointHold.findUniqueOrThrow({
          where: { endpointHash: pushEndpointHash(phone.endpoint) },
        }),
      ).resolves.toMatchObject({ retryAfter: waiting.availableAt });
      expect(pushedTo("phone")).toHaveLength(0);
      expect(pushedTo("laptop")).toHaveLength(1);

      await db.pushTask.update({
        where: { id: first.id },
        data: { createdAt: subHours(new Date(), 25) },
      });
      const expired = await db.pushDelivery.update({
        where: { id: throttled.id },
        data: { availableAt: new Date() },
      });
      await dispatcher.deliver(expired);
      await expect(deliveryTo(first.id, phone.endpoint)).resolves.toMatchObject(
        { status: "expired", responseStatus: 429 },
      );
    } finally {
      await worker.resume();
    }
  });

  it("checks that a notification is unread after waiting on the recipient lock", async () => {
    await owner.post("/push/subscriptions").send(browser("host")).expect(204);
    const { worker } = app.get(PushProcessor);
    const db = app.get(PrismaService);
    const outbox = app.get(PushOutboxRepository);
    const dispatcher = app.get(PushDispatcher);
    await worker.pause();
    try {
      await requestBooking();
      const task = await db.pushTask.findFirstOrThrow();
      await outbox.fanOut(task, task.generation, "stays");
      const delivery = await db.pushDelivery.findFirstOrThrow();
      let sending: Promise<void> | undefined;
      try {
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${task.userId}::uuid FOR NO KEY UPDATE`;
          sending = dispatcher.deliver(delivery);
          await waitUntil(async () => {
            const [row] = await tx.$queryRaw<{ waiting: boolean }[]>`
              SELECT EXISTS (
                SELECT FROM pg_locks WHERE NOT granted
                AND pg_backend_pid() = ANY(pg_blocking_pids(pid))
              ) AS waiting
            `;
            return row?.waiting === true;
          }, 3_000);
          await tx.notification.update({
            where: { id: task.id },
            data: { readAt: new Date() },
          });
        });
      } finally {
        await sending;
      }
      expect(gateway.sent).toEqual([]);
      await expect(
        db.pushDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ).resolves.toMatchObject({
        status: "skipped",
        attempts: 0,
        lastAttemptAt: null,
      });
    } finally {
      await worker.resume();
    }
  });

  it("wakes tasks and deliveries held for quiet hours while preserving a provider retry", async () => {
    for (const device of ["phone", "laptop"]) {
      await owner.post("/push/subscriptions").send(browser(device)).expect(204);
    }
    const { worker } = app.get(PushProcessor);
    const db = app.get(PrismaService);
    const outbox = app.get(PushOutboxRepository);
    const now = new Date();
    const clock = { in: tz("UTC") };
    const quiet = {
      ...DEFAULT_PUSH_PREFERENCES,
      quietHours: {
        from: format(subHours(now, 1), "HH:mm", clock),
        to: format(addHours(now, 1), "HH:mm", clock),
        timeZone: "UTC",
      },
    };
    await worker.pause();
    try {
      await owner.patch("/push/settings").send(quiet).expect(204);
      await requestBooking();
      const task = await db.pushTask.findFirstOrThrow();
      await outbox.fanOut(task, task.generation, "stays");
      await expect(db.pushTask.findFirstOrThrow()).resolves.toMatchObject({
        waitingForQuietHours: true,
      });

      await owner
        .patch("/push/settings")
        .send(DEFAULT_PUSH_PREFERENCES)
        .expect(204);
      const ready = await db.pushTask.findFirstOrThrow();
      expect(ready.availableAt.getTime()).toBeLessThanOrEqual(Date.now());
      await outbox.fanOut(ready, ready.generation, "stays");

      const [waiting, retrying] = await db.pushDelivery.findMany({
        include: { subscription: true },
      });
      if (!waiting?.subscription || !retrying)
        throw new Error("Missing delivery");
      await owner.patch("/push/settings").send(quiet).expect(204);
      await expect(
        outbox.startAttempt(waiting, waiting.subscription, task),
      ).resolves.toBeNull();
      await expect(
        db.pushDelivery.findUniqueOrThrow({ where: { id: waiting.id } }),
      ).resolves.toMatchObject({ waitingForQuietHours: true, attempts: 0 });

      await outbox.retryDelivery(
        retrying.id,
        2 * 60 * 60 * 1000,
        429,
        "Retry later",
        retrying.generation,
      );
      const { availableAt: retryAt } = await db.pushDelivery.findUniqueOrThrow({
        where: { id: retrying.id },
      });
      expect(retryAt.getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000);
      await owner
        .patch("/push/settings")
        .send(DEFAULT_PUSH_PREFERENCES)
        .expect(204);
      const awakened = await db.pushDelivery.findUniqueOrThrow({
        where: { id: waiting.id },
      });
      expect(awakened.waitingForQuietHours).toBe(false);
      expect(awakened.availableAt.getTime()).toBeLessThanOrEqual(Date.now());
      await expect(
        db.pushDelivery.findUniqueOrThrow({ where: { id: retrying.id } }),
      ).resolves.toMatchObject({ availableAt: retryAt });
    } finally {
      await worker.resume();
    }
  });

  it("gives back the hourly slot when a delivery expires before HTTP", async () => {
    await owner.post("/push/subscriptions").send(browser("host")).expect(204);
    await owner
      .patch("/push/settings")
      .send({ ...DEFAULT_PUSH_PREFERENCES, hourlyLimit: 1 })
      .expect(204);

    const { worker } = app.get(PushProcessor);
    const db = app.get(PrismaService);
    const outbox = app.get(PushOutboxRepository);
    await worker.pause();
    try {
      await requestBooking();
      const task = await db.pushTask.findFirstOrThrow();
      await outbox.fanOut(task, task.generation, "stays");
      const delivery = await db.pushDelivery.findFirstOrThrow({
        include: { subscription: true },
      });
      if (!delivery.subscription) throw new Error("Missing subscription");

      const attempt = await outbox.startAttempt(
        delivery,
        delivery.subscription,
        task,
      );
      if (!attempt) throw new Error("Missing attempt");
      await outbox.expireReservedAttempt(delivery.id, task, attempt);
      await expect(
        db.pushDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ).resolves.toMatchObject({
        status: "expired",
        attempts: 0,
        lastAttemptAt: null,
      });
      await expect(
        db.pushTask.findUniqueOrThrow({ where: { id: task.id } }),
      ).resolves.toMatchObject({ lastAttemptAt: null });
    } finally {
      await worker.resume();
    }
  });

  it("pushes what a lost Redis job left behind, once its lease runs out", async () => {
    await owner.post("/push/subscriptions").send(browser("host")).expect(204);
    const { worker } = app.get(PushProcessor);
    await worker.pause();

    try {
      await requestBooking();
      // Redis loses every job; the task is still in Postgres, claimed by the relay.
      await waitUntil(async () => {
        const task = await app.get(PrismaService).pushTask.findFirst();

        return task?.leasedUntil != null && task.leasedUntil > new Date();
      });
      await resetQueue(app);
      await app
        .get(PrismaService)
        .pushTask.updateMany({ data: { leasedUntil: new Date(0) } });
    } finally {
      await worker.resume();
    }

    await waitUntil(() => Promise.resolve(pushedTo("host").length > 0));
    expect(pushedTo("host")).toHaveLength(1);
  });

  it("tries a push service that failed again, and records what it answered", async () => {
    await owner.post("/push/subscriptions").send(browser("host")).expect(204);
    gateway.script.set(browser("host").endpoint, [
      { kind: "unavailable", status: 503, reason: "503 Service Unavailable" },
    ]);
    const prismaService = app.get(PrismaService);

    await requestBooking();
    await waitUntil(async () => {
      const delivery = await prismaService.pushDelivery.findFirst();

      return delivery?.attempts === 1 && delivery.responseStatus === 503;
    });
    // The retry is due in fifteen seconds; the spec does not wait for the clock.
    await prismaService.pushDelivery.updateMany({
      data: { availableAt: new Date(0) },
    });

    await waitUntil(async () => {
      const delivery = await prismaService.pushDelivery.findFirst();
      return delivery?.status === "sent";
    });
    expect(pushedTo("host")).toHaveLength(1);
    await expect(prismaService.pushDelivery.findFirst()).resolves.toMatchObject(
      { attempts: 2, responseStatus: 201 },
    );
  });

  it("keeps a browser refused with 403 until it has been refused for a day", async () => {
    const { endpoint } = browser("refused");
    await owner
      .post("/push/subscriptions")
      .send(browser("refused"))
      .expect(204);
    gateway.script.set(endpoint, [
      { kind: "forbidden", status: 403 },
      { kind: "forbidden", status: 403 },
    ]);
    const prismaService = app.get(PrismaService);

    const refused = () =>
      prismaService.pushDelivery.findMany({
        where: { responseStatus: 403 },
        orderBy: { createdAt: "asc" },
      });

    await requestBooking();
    await waitUntil(async () => (await refused()).length === 1);
    await expect(refused()).resolves.toMatchObject([{ status: "rejected" }]);
    expect(
      await prismaService.pushSubscription.count({ where: { endpoint } }),
    ).toBe(1);

    // The first refusal, and the subscription, a day and an hour back.
    const dayAgo = subHours(new Date(), 25);
    await prismaService.pushSubscription.updateMany({
      where: { endpoint },
      data: { createdAt: subHours(dayAgo, 1) },
    });
    await prismaService.pushDelivery.updateMany({
      where: { responseStatus: 403 },
      data: { lastAttemptAt: dayAgo },
    });

    await guest
      .post("/bookings")
      .send({ listingId, from: inDays(20), to: inDays(22) })
      .expect(201);
    await waitUntil(async () => (await refused()).length === 2);
    await expect(refused()).resolves.toMatchObject([
      { status: "rejected" },
      { status: "gone" },
    ]);
    expect(
      await prismaService.pushSubscription.count({ where: { endpoint } }),
    ).toBe(0);
    expect(pushedTo("refused")).toEqual([]);
  });

  it("takes the service worker's receipts from a stranger, by the delivery's id", async () => {
    await owner.post("/push/subscriptions").send(browser("host")).expect(204);
    await requestBooking();
    await waitUntil(() => Promise.resolve(pushedTo("host").length > 0));

    const receipt = pushedTo("host")[0]?.payload.receipt ?? "";
    const anonymous = request(app.getHttpServer());

    await anonymous
      .post("/push/receipts")
      .send({ id: receipt, event: "clicked" })
      .expect(204);
    // An id nobody was sent is answered the same.
    await anonymous
      .post("/push/receipts")
      .send({ id: "5e7c2a9d-8b1f-4d3e-a6c4-2f9b7d1e8a35", event: "received" })
      .expect(204);

    const delivery = await app
      .get(PrismaService)
      .pushDelivery.findUniqueOrThrow({ where: { id: receipt } });
    expect(delivery.receivedAt).not.toBeNull();
    expect(delivery.clickedAt).toEqual(delivery.receivedAt);
  });
});
