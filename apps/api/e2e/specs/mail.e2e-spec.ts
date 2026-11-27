import { randomUUID } from "node:crypto";
import { addDays, addMinutes, subDays } from "date-fns";
import { Test } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Queue } from "bullmq";
import { Webhook } from "svix";
import {
  mailGroupSchema,
  mailSettingsSchema,
  conversationSchema,
  listingSchema,
  messageSchema,
  messagePageSchema,
  type MailGroup,
} from "@repo/contracts";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { useBodyParsers } from "../../src/common/body-parsers";
import {
  InboundMailAboveQuotaError,
  MailDeliveryError,
  MailGateway,
  MailIdempotencyConflict,
  MailQuotaError,
  MailRateLimitError,
} from "../../src/mail/application/ports/mail-gateway";
import {
  InMemoryMailGateway,
  readMailRequest,
} from "../../src/mail/infrastructure/mail-gateways";
import { MailInbox } from "../../src/mail/application/mail-inbox";
import { MAIL_EVENT_ATTEMPTS } from "../../src/mail/application/mail-event";
import {
  MAIL_PROCESSING_FAILURES,
  MAIL_SEND_ATTEMPTS,
} from "../../src/mail/application/mail-task";
import { replyTokenHash } from "../../src/mail/application/mail-content";
import { MailRepository } from "../../src/mail/infrastructure/mail.repository";
import { MailOutboxRelay } from "../../src/mail/infrastructure/mail-outbox.relay";
import { MailOutboxRepository } from "../../src/mail/infrastructure/mail-outbox.repository";
import { MailQueue } from "../../src/mail/infrastructure/mail.queue";
import { PrismaService } from "../../src/prisma/prisma.service";
import { NotificationService } from "../../src/notification/notification.service";
import { resetDatabase } from "../support/database";
import { resetQueue } from "../support/queue";
import { signIn, testCredentials, type Agent } from "../support/session";
import { waitUntil } from "../support/wait-until";

describe("Transactional mail", () => {
  const address = "host@mail.test";
  const availability = {
    listingId: randomUUID(),
    listingTitle: "Harbour <Loft>",
    from: "2027-01-01",
    to: "2027-01-02",
  };
  const secret =
    "whsec_" + Buffer.from("test-signing-secret").toString("base64");
  let app: NestExpressApplication;
  let host: Agent;
  let gateway: InMemoryMailGateway;
  let hostId: string;
  const initial = {
    secret: process.env.RESEND_WEBHOOK_SECRET,
    domain: process.env.MAIL_REPLY_DOMAIN,
  };
  beforeEach(async () => {
    process.env.RESEND_WEBHOOK_SECRET = secret;
    process.env.MAIL_REPLY_DOMAIN = "mail.test";
    gateway = new InMemoryMailGateway();
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailGateway)
      .useValue(gateway)
      .compile();
    app = fixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    useBodyParsers(app);
    await app.init();
    await resetDatabase(app);
    await resetQueue(app);
    host = await signIn(app, { ...testCredentials, email: address });
    hostId = (
      await app
        .get(PrismaService)
        .user.findUniqueOrThrow({ where: { email: address } })
    ).id;
  });
  afterEach(async () => {
    await app.close();
    if (initial.secret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = initial.secret;
    if (initial.domain === undefined) delete process.env.MAIL_REPLY_DOMAIN;
    else process.env.MAIL_REPLY_DOMAIN = initial.domain;
  });

  async function confirm() {
    const token = await confirmationToken();
    await host.post("/mail/confirm").send({ token }).expect(204);
    await host.post("/mail/confirm").send({ token }).expect(400);
  }

  async function enableMail(...groups: MailGroup[]) {
    const muted = mailGroupSchema.options.filter(
      (group) => !groups.includes(group),
    );
    await host.patch("/mail/settings").send({ muted }).expect(204);
  }

  async function confirmationToken() {
    let token: string | undefined;
    await waitUntil(() => {
      const letter = [...gateway.sent.values()].find(
        (value) => value.to === address,
      );
      token = tokenFrom(letter?.text);
      return Promise.resolve(token !== undefined);
    });
    if (!token) throw new Error("Missing confirmation token");
    return token;
  }

  function tokenFrom(text?: string) {
    return text?.match(/confirm-email#([a-f0-9]{64})/)?.[1];
  }

  async function requestReset() {
    const server = app.getHttpServer();
    await request(server)
      .post("/auth/password/reset/request")
      .send({ email: address })
      .expect(202, { accepted: true });
    const link = await app.get(PrismaService).accountMail.findFirstOrThrow({
      where: { kind: "reset", userId: hostId },
      orderBy: { createdAt: "desc" },
    });
    await app.get(MailOutboxRelay).sweep();
    return link;
  }

  async function completeReset(id: string) {
    const key = "account-" + id;
    await waitUntil(() => Promise.resolve(gateway.sent.has(key)));
    const token = gateway.sent
      .get(key)
      ?.text.match(/reset-password#([a-f0-9]{64})/)?.[1];
    if (!token) throw new Error("Missing password reset token");
    await request(app.getHttpServer())
      .post("/auth/password/reset/complete")
      .send({ token, password: "replacement-password" })
      .expect(204);
  }

  function webhook(
    type: string,
    recipients:
      | string[]
      | {
          to: string[];
          cc?: string[];
          bcc?: string[];
          received_for?: string[];
        },
    emailId: string,
    eventId: string,
    valid = true,
    createdAt = new Date(),
    receivedAt?: Date,
    failureReason?: string,
  ) {
    const now = new Date();
    const payload = JSON.stringify({
      type,
      created_at: createdAt.toISOString(),
      data: {
        email_id: emailId,
        created_at: receivedAt?.toISOString(),
        ...(Array.isArray(recipients) ? { to: recipients } : recipients),
        from: "stranger@mail.test",
        bounce: { type: "Permanent" },
        failed:
          failureReason === undefined ? undefined : { reason: failureReason },
      },
    });
    const signature = new Webhook(secret).sign(eventId, now, payload);
    return request(app.getHttpServer())
      .post("/webhooks/mail")
      .set("Content-Type", "application/json")
      .set("svix-id", eventId)
      .set("svix-timestamp", String(Math.floor(now.getTime() / 1000)))
      .set("svix-signature", valid ? signature : "invalid")
      .send(payload);
  }

  async function waitForEvent(id: string) {
    const db = app.get(PrismaService);
    await waitUntil(
      async () =>
        !!(await db.mailEvent.findUnique({ where: { id } }))?.processedAt,
    );
  }

  async function startThread() {
    const guest = await signIn(app);
    const listing = listingSchema.parse(
      (
        await host
          .post("/listings")
          .send({
            title: "Harbour loft",
            description: "A quiet loft above the harbour.",
            pricePerNightCents: 12000,
            capacity: 4,
          })
          .expect(201)
      ).body,
    );
    const thread = conversationSchema.parse(
      (
        await guest
          .post("/conversations")
          .send({
            listingId: listing.id,
            body: "Can we arrive early?",
          })
          .expect(201)
      ).body,
    );
    return { guest, thread };
  }

  async function sendMessage(guest: Agent, threadId: string, body: string) {
    return messageSchema.parse(
      (
        await guest
          .post("/conversations/" + threadId + "/messages")
          .send({ body })
          .expect(201)
      ).body,
    );
  }

  function mailQueue() {
    return app.get<Queue>(getQueueToken("mail"));
  }

  async function promoteDigests(count: number) {
    let jobs: Awaited<ReturnType<Queue["getDelayed"]>> = [];
    await waitUntil(async () => {
      jobs = (await mailQueue().getDelayed()).filter(
        (job) => job.name === "digest",
      );
      return jobs.length === count;
    });
    for (const job of jobs) await job.promote();
  }

  async function promoteDigest(id: string) {
    const key = "digest-" + id;
    const queue = mailQueue();
    await waitUntil(async () => (await queue.getJobState(key)) === "delayed");
    const job = await queue.getJob(key);
    if (!job) throw new Error("Missing delayed digest");
    await job.promote();
  }

  async function firstMessageId(threadId: string) {
    const { id } = await app.get(PrismaService).message.findFirstOrThrow({
      where: { conversationId: threadId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    return id;
  }

  it("sets aside a conflicting delivery payload on its first refusal", async () => {
    await confirm();
    const send = jest
      .spyOn(gateway, "send")
      .mockRejectedValue(new MailIdempotencyConflict());
    const email = "collision@mail.test";
    await signIn(app, { ...testCredentials, email });
    const db = app.get(PrismaService);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await waitUntil(
      async () =>
        !!(await db.mailOutbox.findFirst({
          where: { userId: user.id, failedAt: { not: null } },
        })),
    );
    expect(
      await db.mailOutbox.findFirstOrThrow({ where: { userId: user.id } }),
    ).toMatchObject({
      sendAttempts: 1,
      processingFailures: 1,
      lastError: "Resend returned HTTP 409: invalid_idempotent_request",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 401, previousFailures: 0 },
    { status: 503, previousFailures: MAIL_PROCESSING_FAILURES - 1 },
  ])(
    "sets aside a failed confirmation preflight with HTTP $status",
    async ({ status, previousFailures }) => {
      await confirm();
      const db = app.get(PrismaService);
      await db.user.update({
        where: { id: hostId },
        data: { emailUndeliverableAt: new Date() },
      });
      const queue = mailQueue();
      await queue.pause();
      const checkSuppression = jest
        .spyOn(gateway, "isSuppressed")
        .mockResolvedValueOnce(false)
        .mockRejectedValue(new MailDeliveryError("Provider error", status));
      const send = jest.spyOn(gateway, "send");
      await host.post("/mail/resend").expect(204);
      const task = await db.mailOutbox.findFirstOrThrow({
        where: { userId: hostId, kind: "confirm", sendAttempts: 0 },
      });
      await db.mailOutbox.update({
        where: { id: task.id },
        data: { processingFailures: previousFailures },
      });
      await queue.resume();

      const key = "confirm-" + task.id;
      await waitUntil(async () => (await queue.getJobState(key)) === "failed");
      const failedTask = await db.mailOutbox.findUniqueOrThrow({
        where: { id: task.id },
      });
      expect(failedTask.failedAt).toBeInstanceOf(Date);
      expect(failedTask).toMatchObject({
        lastError: "Mail provider returned HTTP " + String(status),
        processingFailures: previousFailures + 1,
        sendAttempts: 0,
      });

      await queue.remove(key);
      await db.mailOutbox.update({
        where: { id: task.id },
        data: { availableAt: new Date(0) },
      });
      await app.get(MailOutboxRelay).sweep();
      expect(await queue.getJobState(key)).toBe("unknown");
      expect(checkSuppression).toHaveBeenCalledTimes(2);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([
    { status: 401, previousAttempts: 0 },
    { status: 503, previousAttempts: MAIL_EVENT_ATTEMPTS - 1 },
  ])(
    "sets aside an email event after HTTP $status and acknowledges redelivery",
    async ({ status, previousAttempts }) => {
      const inbox = app.get(MailInbox);
      const pause = jest.spyOn(inbox, "sweep").mockResolvedValue(undefined);
      const receive = jest
        .spyOn(gateway, "receive")
        .mockRejectedValue(new MailDeliveryError("Provider error", status));
      const emailId = randomUUID();
      const eventId = randomUUID();
      const db = app.get(PrismaService);
      await webhook("email.received", [], emailId, eventId).expect(200);
      await db.mailEvent.update({
        where: { id: eventId },
        data: { attempts: previousAttempts },
      });
      pause.mockRestore();
      await inbox.sweep();

      const failedEvent = await db.mailEvent.findUniqueOrThrow({
        where: { id: eventId },
      });
      expect(failedEvent.failedAt).toBeInstanceOf(Date);
      expect(failedEvent).toMatchObject({
        processedAt: null,
        lastError: "Mail provider returned HTTP " + String(status),
        attempts: previousAttempts + 1,
      });
      await db.mailEvent.update({
        where: { id: eventId },
        data: { availableAt: new Date(0) },
      });
      await webhook("email.received", [], emailId, eventId).expect(200);
      await inbox.sweep();
      expect(receive).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["CANCELLATION_REFUND_FAILED", "stuck-refunds"],
    ["PAYOUT_FAILED", "stuck-payouts"],
  ] as const)(
    "keeps internal details out of the %s email",
    async (type, list) => {
      await confirm();
      await enableMail("payments");
      const data = {
        bookingId: randomUUID(),
        error: "Internal provider error",
      };
      await app.get(NotificationService).notify(hostId, { type, data });
      const link =
        "/admin/payments?list=" + list + "&bookingId=" + data.bookingId;
      await waitUntil(() =>
        Promise.resolve(
          [...gateway.sent.values()].some((letter) =>
            letter.text.includes(link),
          ),
        ),
      );
      const letter = [...gateway.sent.values()].find((letter) =>
        letter.text.includes(link),
      );
      expect(letter?.text).toContain(
        "Review the details in the admin dashboard.",
      );
      expect(letter?.text).not.toContain(data.error);
      expect(letter?.html).not.toContain(data.error);
      const stored = await app
        .get(PrismaService)
        .notification.findFirstOrThrow({
          where: { userId: hostId, type },
        });
      expect(stored.data).toEqual(data);
    },
  );

  it("confirms once, respects preferences, suppresses a bounced address and lets its owner reconfirm", async () => {
    await confirm();
    const settings = mailSettingsSchema.parse(
      (await host.get("/mail/settings").expect(200)).body,
    );
    expect(settings.muted).toEqual(mailGroupSchema.options);
    expect(settings.canRequestConfirmation).toBe(false);
    await enableMail("waitlist");
    const notify = app.get(NotificationService);
    const data = availability;
    await notify.notify(hostId, { type: "WAITLIST_AVAILABLE", data });
    await waitUntil(() => Promise.resolve(gateway.sent.size === 2));
    expect([...gateway.sent.values()].at(-1)?.html).toContain(
      "Harbour &lt;Loft&gt;",
    );
    await host
      .patch("/mail/settings")
      .send({ muted: ["waitlist"] })
      .expect(204);
    await notify.notify(hostId, { type: "WAITLIST_AVAILABLE", data });
    const queue = mailQueue();
    const db = app.get(PrismaService);
    await waitUntil(
      async () =>
        (await db.mailOutbox.count({ where: { kind: "notice" } })) === 0 &&
        (await queue.getActiveCount()) + (await queue.getWaitingCount()) === 0,
    );
    expect(gateway.sent.size).toBe(2);
    const eventId = randomUUID(),
      emailId = randomUUID();
    await webhook("email.bounced", [address], emailId, eventId, false).expect(
      400,
    );
    gateway.suppressed.add(address);
    await webhook("email.bounced", [address], emailId, eventId).expect(200);
    await waitUntil(async () => {
      const response = await host.get("/mail/settings").expect(200);
      return mailSettingsSchema.parse(response.body).undeliverable;
    });
    expect(
      mailSettingsSchema.parse((await host.get("/mail/settings")).body),
    ).toEqual({
      verified: true,
      undeliverable: true,
      canRequestConfirmation: true,
      muted: ["waitlist"],
    });
    gateway.sent.clear();
    const blocked = await host.post("/mail/resend").expect(409);
    expect(blocked.body).toMatchObject({ code: "EMAIL_DELIVERY_SUPPRESSED" });
    expect(gateway.sent.size).toBe(0);
    gateway.suppressed.delete(address);
    await host.post("/mail/resend").expect(204);
    await confirm();
    const late = randomUUID();
    const user = await db.user.findUniqueOrThrow({ where: { id: hostId } });
    if (!user.emailDeliveryRestoredAt)
      throw new Error("Missing recovery check");
    const earlier = new Date(user.emailDeliveryRestoredAt.getTime() - 1);
    await webhook(
      "email.bounced",
      [address],
      emailId,
      late,
      true,
      earlier,
    ).expect(200);
    await waitForEvent(late);
    expect(
      mailSettingsSchema.parse((await host.get("/mail/settings")).body)
        .undeliverable,
    ).toBe(false);
  });

  it("stores only account IDs on delivery events even if processing fails and the account is erased", async () => {
    const inbox = app.get(MailInbox);
    const pause = jest.spyOn(inbox, "sweep").mockResolvedValue(undefined);
    const db = app.get(PrismaService);
    const id = randomUUID();
    await webhook(
      "email.complained",
      [address.toUpperCase()],
      randomUUID(),
      id,
    ).expect(200);
    const event = await db.mailEvent.update({
      where: { id },
      data: { attempts: MAIL_EVENT_ATTEMPTS - 1 },
    });
    expect(event.recipientIds).toEqual([hostId]);
    expect(JSON.stringify(event)).not.toContain(address.toUpperCase());

    const suppress = jest
      .spyOn(app.get(MailRepository), "suppress")
      .mockRejectedValueOnce(new Error("Temporary database failure"));
    pause.mockRestore();
    await inbox.sweep();
    expect(
      (await db.mailEvent.findUniqueOrThrow({ where: { id } })).failedAt,
    ).toBeInstanceOf(Date);

    await host
      .delete("/users/me")
      .send({ password: testCredentials.password })
      .expect(204);
    const failed = await db.mailEvent.findUniqueOrThrow({ where: { id } });
    expect(JSON.stringify(failed).toLowerCase()).not.toContain(address);
    expect(failed.recipientIds).toEqual([hostId]);
    suppress.mockRestore();
  });

  it("correlates provider acceptance with signed delivery events without pausing the recipient", async () => {
    const db = app.get(PrismaService);
    const providerId = randomUUID();
    const send = gateway.send.bind(gateway);
    jest.spyOn(gateway, "send").mockImplementation(async (letter, key) => {
      await send(letter, key);
      return key.startsWith("account-") ? providerId : undefined;
    });
    const email = "new@mail.test";
    await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email })
      .expect(202);
    const action = await db.accountMail.findFirstOrThrow({
      where: { email, kind: "register" },
    });
    await waitForEvent("accepted/" + providerId);
    expect(
      await db.mailEvent.findUnique({
        where: { id: "accepted/" + providerId },
      }),
    ).toMatchObject({
      kind: "email.accepted",
      emailId: providerId,
      outboxId: action.id,
      recipientIds: [],
    });
    for (const kind of [
      "email.sent",
      "email.delivery_delayed",
      "email.delivered",
      "email.failed",
    ]) {
      const eventId = randomUUID();
      await webhook(kind, [address], providerId, eventId).expect(200);
      await waitForEvent(eventId);
      expect(
        await db.mailEvent.findUnique({ where: { id: eventId } }),
      ).toMatchObject({
        kind,
        emailId: providerId,
        recipientIds: [],
      });
    }
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: hostId } }))
        .emailUndeliverableAt,
    ).toBeNull();
  });

  it("can deliver a reset after support lifts suppression without a sign-in", async () => {
    await confirm();
    const db = app.get(PrismaService);
    await db.user.update({
      where: { id: hostId },
      data: { emailUndeliverableAt: addMinutes(Date.now(), -1) },
    });
    gateway.suppressed.add(address);

    const rejected = await requestReset();
    await waitUntil(async () =>
      Boolean(
        await db.mailOutbox.findFirst({
          where: { id: rejected.id, failedAt: { not: null } },
        }),
      ),
    );
    expect(gateway.sent.has("account-" + rejected.id)).toBe(false);
    expect(
      await db.mailOutbox.findUnique({ where: { id: rejected.id } }),
    ).toMatchObject({
      lastError: "Account recovery email is suppressed",
    });

    gateway.suppressed.delete(address);
    await db.accountMail.update({
      where: { id: rejected.id },
      data: { createdAt: addMinutes(Date.now(), -3) },
    });
    const restored = await requestReset();
    expect(restored.id).not.toBe(rejected.id);
    await completeReset(restored.id);
  });

  it("records a permanent provider failure on an accepted confirmation", async () => {
    await confirmationToken();
    const db = app.get(PrismaService);
    const providerId = randomUUID();
    const send = jest.spyOn(gateway, "send").mockResolvedValueOnce(providerId);
    await host.post("/mail/resend").expect(204);
    await waitForEvent("accepted/" + providerId);

    const reason = "invalid_recipient";
    const eventId = randomUUID();
    await webhook(
      "email.failed",
      [address],
      providerId,
      eventId,
      true,
      new Date(),
      undefined,
      reason,
    ).expect(200);
    await waitForEvent(eventId);
    const failed = await db.mailOutbox.findUnique({
      where: { acceptedEmailId: providerId },
    });
    expect(failed).toMatchObject({
      kind: "confirm",
      lastError: reason,
      providerRetry: 0,
    });
    expect(failed?.failedAt).toBeInstanceOf(Date);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("starts the reset link's lifetime after a quota deferral", async () => {
    await confirm();
    const db = app.get(PrismaService);
    const retryAt = addDays(new Date(), 8);
    const send = jest
      .spyOn(gateway, "send")
      .mockRejectedValueOnce(new MailQuotaError(retryAt));
    const link = await requestReset();
    const key = "account-" + link.id;
    await waitUntil(async () =>
      Boolean(
        await db.mailOutbox.findFirst({
          where: { id: link.id, deliveryRound: 1 },
        }),
      ),
    );
    expect(
      await db.accountMail.findUnique({ where: { id: link.id } }),
    ).toMatchObject({
      expiresAt: null,
    });

    await db.accountMail.update({
      where: { id: link.id },
      data: { createdAt: addMinutes(Date.now(), -3) },
    });
    expect((await requestReset()).id).toBe(link.id);
    expect(
      await db.accountMail.count({ where: { userId: hostId, kind: "reset" } }),
    ).toBe(1);

    await app.get(MailRepository).pruneHistory(retryAt);
    await db.mailOutbox.update({
      where: { id: link.id },
      data: { availableAt: new Date() },
    });
    await app.get(MailOutboxRelay).sweep();
    await completeReset(link.id);
    const attempts = send.mock.calls.filter(([, jobKey]) => jobKey === key);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
  });

  it("stops pushing to the account's browsers once its password is reset", async () => {
    await confirm();
    const endpoint = "https://fcm.googleapis.com/fcm/send/before-reset";
    await host
      .post("/push/subscriptions")
      .send({
        endpoint,
        keys: {
          p256dh:
            "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
          auth: "tBHItJI5svbpez7KI4CCXg",
        },
      })
      .expect(204);

    await completeReset((await requestReset()).id);

    expect(
      await app
        .get(PrismaService)
        .pushSubscription.count({ where: { userId: hostId } }),
    ).toBe(0);
    const again = request.agent(app.getHttpServer());
    await again
      .post("/auth/login")
      .send({ email: address, password: "replacement-password" })
      .expect(200);
    await again
      .post("/push/subscriptions/status")
      .send({ endpoint })
      .expect(200, { registered: false });
  });

  it("drops an unsent reset when the account version changes", async () => {
    await confirm();
    const db = app.get(PrismaService);
    const pause = jest
      .spyOn(app.get(MailOutboxRelay), "sweep")
      .mockResolvedValue(undefined);
    const link = await requestReset();
    await db.user.update({
      where: { id: hostId },
      data: { sessionVersion: { increment: 1 } },
    });
    pause.mockRestore();
    await app.get(MailOutboxRelay).sweep();
    await waitUntil(
      async () => (await db.mailOutbox.count({ where: { id: link.id } })) === 0,
    );
    expect(gateway.sent.has("account-" + link.id)).toBe(false);
  });

  it.each([true, false])(
    "retries a signed quota failure with a new provider key (webhook first: %s)",
    async (webhookFirst) => {
      await confirm();
      const db = app.get(PrismaService);
      const providerId = randomUUID();
      const eventId = randomUUID();
      const reason = "reached_daily_quota";

      const sendFailure = () =>
        webhook(
          "email.failed",
          [address],
          providerId,
          eventId,
          true,
          new Date(),
          undefined,
          reason,
        ).expect(200);

      const send = jest
        .spyOn(gateway, "send")
        .mockImplementationOnce(async () => {
          if (webhookFirst) {
            await sendFailure();
            await waitForEvent(eventId);
          }
          return providerId;
        });

      const link = await requestReset();
      await waitForEvent("accepted/" + providerId);
      if (!webhookFirst) await sendFailure();
      await waitForEvent(eventId);
      await waitUntil(
        async () =>
          (await db.mailOutbox.findUnique({ where: { id: link.id } }))
            ?.providerRetry === 1,
      );
      expect(
        await db.mailEvent.findUnique({ where: { id: eventId } }),
      ).toMatchObject({
        providerFailureReason: reason,
      });
      expect(
        await db.mailOutbox.findUnique({ where: { id: link.id } }),
      ).toMatchObject({
        sendAttempts: 0,
        acceptedEmailId: null,
      });
      expect(
        await db.accountMail.findUnique({ where: { id: link.id } }),
      ).toMatchObject({
        expiresAt: null,
      });

      await sendFailure();
      await db.mailOutbox.update({
        where: { id: link.id },
        data: { availableAt: new Date() },
      });
      await app.get(MailOutboxRelay).sweep();
      await waitUntil(() =>
        Promise.resolve(gateway.sent.has("account-" + link.id + "-retry-1")),
      );
      expect(send.mock.calls.map(([, key]) => key)).toEqual([
        "account-" + link.id,
        "account-" + link.id + "-retry-1",
      ]);
    },
  );

  it("records an expired reset when a previous send might already have reached the provider", async () => {
    await confirm();
    const db = app.get(PrismaService);
    const send = jest
      .spyOn(gateway, "send")
      .mockRejectedValueOnce(new Error("Response lost"));
    const link = await requestReset();
    const key = "account-" + link.id;
    await waitUntil(
      async () => (await mailQueue().getJobState(key)) === "delayed",
    );
    await db.accountMail.update({
      where: { id: link.id },
      data: { expiresAt: addMinutes(Date.now(), -1) },
    });
    const replacement = await requestReset();
    expect(replacement.id).not.toBe(link.id);
    const job = await mailQueue().getJob(key);
    if (!job) throw new Error("Missing reset retry");
    await job.promote();
    await waitUntil(
      async () => (await mailQueue().getJobState(key)) === "failed",
    );
    expect(
      await db.mailOutbox.findUnique({ where: { id: link.id } }),
    ).toMatchObject({
      lastError: "Account email expired before delivery could be retried",
    });
    expect(send.mock.calls.filter(([, jobKey]) => jobKey === key)).toHaveLength(
      1,
    );
    await waitUntil(() =>
      Promise.resolve(gateway.sent.has("account-" + replacement.id)),
    );
  });

  it("refuses a resend for demo addresses and confirmed accounts", async () => {
    const demo = await signIn(app);
    const demoSettings = mailSettingsSchema.parse(
      (await demo.get("/mail/settings").expect(200)).body,
    );
    expect(demoSettings).toMatchObject({
      verified: false,
      canRequestConfirmation: false,
    });
    expect((await demo.post("/mail/resend").expect(409)).body).toMatchObject({
      code: "EMAIL_CONFIRMATION_UNAVAILABLE",
    });

    const hostSettings = mailSettingsSchema.parse(
      (await host.get("/mail/settings").expect(200)).body,
    );
    expect(hostSettings.canRequestConfirmation).toBe(true);
    await confirm();
    expect((await host.post("/mail/resend").expect(409)).body).toMatchObject({
      code: "EMAIL_CONFIRMATION_UNAVAILABLE",
      message: "Your email is already confirmed.",
    });
  });

  it("applies a late complaint even when the first confirmation has just succeeded", async () => {
    const token = await confirmationToken();
    const createdAt = new Date();
    await host.post("/mail/confirm").send({ token }).expect(204);
    const id = randomUUID();
    await webhook(
      "email.complained",
      [address],
      randomUUID(),
      id,
      true,
      createdAt,
    ).expect(200);
    await waitForEvent(id);
    const settings = mailSettingsSchema.parse(
      (await host.get("/mail/settings").expect(200)).body,
    );
    expect(settings).toMatchObject({ verified: true, undeliverable: true });
  });
  it("keeps the delivered link usable after a failed resend and invalidates both links on confirmation", async () => {
    await waitUntil(() => Promise.resolve(gateway.sent.size === 1));
    const original = tokenFrom([...gateway.sent.values()][0]?.text);
    expect(original).toBeDefined();
    const failure = new Error("Provider unavailable");
    const send = jest.spyOn(gateway, "send").mockRejectedValueOnce(failure);
    await host.post("/mail/resend").expect(204);
    await waitUntil(() => Promise.resolve(send.mock.calls.length > 0));
    const request = send.mock.calls[0]?.[0];
    const rejected = tokenFrom(request && readMailRequest(request).text);
    expect(rejected).toBeDefined();
    expect(rejected).not.toBe(original);
    await host.post("/mail/confirm").send({ token: original }).expect(204);
    await host.post("/mail/confirm").send({ token: rejected }).expect(400);
    await host.post("/mail/confirm").send({ token: original }).expect(400);
  });

  it("skips an outgoing notice if the account is erased before dispatch", async () => {
    await confirm();
    await enableMail("waitlist");
    const repo = app.get(MailRepository);
    const notice = repo.notice.bind(repo);
    const read = jest
      .spyOn(repo, "notice")
      .mockImplementationOnce(async (id, userId) => {
        const content = await notice(id, userId);
        await host
          .delete("/users/me")
          .send({ password: testCredentials.password })
          .expect(204);
        return content;
      });
    await app.get(NotificationService).notify(hostId, {
      type: "WAITLIST_AVAILABLE",
      data: {
        listingId: randomUUID(),
        listingTitle: "Harbour loft",
        from: "2027-01-01",
        to: "2027-01-02",
      },
    });
    const queue = mailQueue();
    await waitUntil(
      async () =>
        read.mock.calls.length === 1 && (await queue.getActiveCount()) === 0,
    );
    expect(gateway.sent.size).toBe(1);
    const user = await app
      .get(PrismaService)
      .user.findUniqueOrThrow({ where: { id: hostId } });
    expect(user.deletedAt).not.toBeNull();
  });

  it("skips a prepared notice after the recipient mutes its group", async () => {
    await confirm();
    await enableMail("waitlist");
    const outbox = app.get(MailOutboxRepository);
    const freezeDelivery = outbox.freezeDelivery.bind(outbox);
    const prepared = jest
      .spyOn(outbox, "freezeDelivery")
      .mockImplementationOnce(async (task, candidate) => {
        const delivery = await freezeDelivery(task, candidate);
        await enableMail();
        return delivery;
      });
    await app.get(NotificationService).notify(hostId, {
      type: "WAITLIST_AVAILABLE",
      data: availability,
    });
    const db = app.get(PrismaService);
    await waitUntil(
      async () =>
        prepared.mock.calls.length === 1 &&
        (await db.mailOutbox.count({ where: { kind: "notice" } })) === 0,
    );
    expect(gateway.sent.size).toBe(1);
  });

  it("lets the account be erased while the provider is still sending", async () => {
    await confirm();
    await enableMail("waitlist");

    let release: () => void = () => undefined;

    const finish = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = jest
      .spyOn(gateway, "send")
      .mockImplementationOnce(() => finish);
    try {
      await app.get(NotificationService).notify(hostId, {
        type: "WAITLIST_AVAILABLE",
        data: availability,
      });
      await waitUntil(() => Promise.resolve(send.mock.calls.length > 0));
      await host
        .delete("/users/me")
        .send({ password: testCredentials.password })
        .timeout({ deadline: 2500 })
        .expect(204);
    } finally {
      release();
    }
  });

  it("recovers all three kinds of mail after Redis refuses the enqueue", async () => {
    await confirm();
    await enableMail("waitlist", "messages");
    const relay = app.get(MailOutboxRelay);
    const queue = jest
      .spyOn(app.get(MailQueue), "schedule")
      .mockResolvedValue("unavailable");
    const db = app.get(PrismaService);
    const newAddress = "outbox@mail.test";
    await app
      .get(NotificationService)
      .notify(hostId, { type: "WAITLIST_AVAILABLE", data: availability });
    await signIn(app, { ...testCredentials, email: newAddress });
    await startThread();

    await relay.sweep();
    const pending = await db.mailOutbox.findMany();
    expect(queue).toHaveBeenCalled();
    expect(pending.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(["confirm", "notice", "digest"]),
    );

    queue.mockRestore();
    await db.mailOutbox.updateMany({ data: { availableAt: new Date() } });
    await relay.sweep();
    await waitUntil(
      async () =>
        (await db.mailOutbox.count({ where: { kind: { not: "digest" } } })) ===
          0 &&
        [...gateway.sent.values()].some(
          (letter) => letter.to === newAddress && !!tokenFrom(letter.text),
        ) &&
        [...gateway.sent.values()].some(
          (letter) =>
            letter.to === address &&
            letter.subject === "Nights you waited for are free",
        ),
    );
    expect(
      [...gateway.sent.values()].map(({ to, subject }) => [to, subject]),
    ).toEqual([
      [address, "Confirm your email address"],
      [newAddress, "Confirm your email address"],
      [address, "Nights you waited for are free"],
    ]);
    const digest = await db.mailOutbox.findFirstOrThrow({
      where: { kind: "digest" },
    });
    const jobId = "digest-" + digest.id;
    const delayed = await mailQueue().getJob(jobId);
    if (!delayed) throw new Error("Missing delayed digest");
    expect(await delayed.getState()).toBe("delayed");
    await delayed.remove();
    expect(await mailQueue().getJobState(jobId)).toBe("unknown");

    await db.mailOutbox.update({
      where: { id: digest.id },
      data: { availableAt: new Date() },
    });
    await relay.sweep();
    await promoteDigests(1);
    await waitUntil(
      async () =>
        gateway.sent.has(jobId) &&
        (await db.mailOutbox.count({ where: { id: digest.id } })) === 0,
    );
  });

  it.each([false, true])(
    "recovers a quota-rejected confirmation after Redis loses the job (earlier rate limit: %s)",
    async (rateLimitedFirst) => {
      await confirm();
      const db = app.get(PrismaService);
      const email = "quota@mail.test";
      const retryAt = addDays(new Date(), 8);
      const rateRetryAt = addMinutes(new Date(), 1);
      const send = jest.spyOn(gateway, "send");
      if (rateLimitedFirst)
        send.mockRejectedValueOnce(new MailRateLimitError(rateRetryAt));
      send.mockRejectedValueOnce(new MailQuotaError(retryAt));
      const account = await signIn(app, { ...testCredentials, email });
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      if (rateLimitedFirst) {
        await waitUntil(
          async () =>
            !!(await db.mailOutbox.findFirst({
              where: { userId: user.id, deliveryRound: 1 },
            })),
        );
        const task = await db.mailOutbox.findFirstOrThrow({
          where: { userId: user.id },
        });
        const jobId = "confirm-" + task.id;
        expect(task).toMatchObject({
          availableAt: rateRetryAt,
          startedAt: null,
          sendAttempts: 0,
        });
        await waitUntil(
          async () => (await mailQueue().getJobState(jobId)) === "completed",
        );
        expect(await mailQueue().getJobState(jobId + "-1")).toBe("unknown");
        await db.mailOutbox.update({
          where: { id: task.id },
          data: { availableAt: new Date() },
        });
        await app.get(MailOutboxRelay).sweep();
      }
      const quotaRound = rateLimitedFirst ? 2 : 1;
      await waitUntil(
        async () =>
          !!(await db.mailOutbox.findFirst({
            where: { userId: user.id, deliveryRound: quotaRound },
          })),
      );
      const deferred = await db.mailOutbox.findFirstOrThrow({
        where: { userId: user.id },
      });
      const key = "confirm-" + deferred.id;
      const quotaRequest = send.mock.calls
        .filter(([, jobKey]) => jobKey === key)
        .at(-1)?.[0];
      if (!quotaRequest) throw new Error("Missing quota-rejected request");
      const token = tokenFrom(readMailRequest(quotaRequest).text);
      expect(token).toBeDefined();
      expect(deferred).toMatchObject({
        availableAt: retryAt,
        startedAt: null,
        sendAttempts: 0,
      });
      expect(deferred.deliverySnapshot).toEqual(expect.any(String));
      expect(deferred.deliverySnapshot).not.toContain(token);
      await app.get(MailOutboxRelay).sweep();
      expect(await mailQueue().getJobState(key + "-" + quotaRound)).toBe(
        "unknown",
      );
      expect(gateway.sent.has(key)).toBe(false);
      const refusedJobId = rateLimitedFirst ? key + "-1" : key;
      await waitUntil(
        async () =>
          (await mailQueue().getJobState(refusedJobId)) === "completed",
      );
      await mailQueue().remove(refusedJobId);

      // Advance the stored deadline and expire the old link as a long quota pause would.
      await db.mailConfirmation.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(0) },
      });
      await db.mailOutbox.update({
        where: { id: deferred.id },
        data: { availableAt: new Date() },
      });
      const env = jest.replaceProperty(process, "env", {
        ...process.env,
        MAIL_FROM: "replacement@mail.test",
        SITE_ORIGIN: "https://replacement.test",
      });
      try {
        await app.get(MailOutboxRelay).sweep();
        await waitUntil(
          async () =>
            gateway.sent.has(key) &&
            (await db.mailOutbox.count({ where: { id: deferred.id } })) === 0,
        );
        const requests = send.mock.calls.filter(([, jobKey]) => jobKey === key);
        expect(requests).toHaveLength(rateLimitedFirst ? 3 : 2);
        for (const request of requests)
          expect(request).toEqual([quotaRequest, key]);
        await account.post("/mail/confirm").send({ token }).expect(204);
      } finally {
        env.restore();
      }
    },
  );

  it("preserves the retry deadline when a quota refusal follows a lost answer", async () => {
    await confirm();
    const db = app.get(PrismaService);
    const email = "quota-after-timeout@mail.test";
    const retryAt = new Date(Date.now() + 60_000);
    const send = jest
      .spyOn(gateway, "send")
      .mockRejectedValueOnce(
        new Error("The provider may have accepted the request"),
      )
      .mockRejectedValueOnce(new MailQuotaError(retryAt));
    await signIn(app, { ...testCredentials, email });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const outbox = await db.mailOutbox.findFirstOrThrow({
      where: { userId: user.id },
    });
    const key = "confirm-" + outbox.id;
    await waitUntil(
      async () => (await mailQueue().getJobState(key)) === "delayed",
    );
    const attempted = await db.mailOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
    });
    expect(attempted.startedAt).toBeInstanceOf(Date);
    const job = await mailQueue().getJob(key);
    if (!job) throw new Error("Missing retry job");
    await job.promote();
    await waitUntil(
      async () =>
        !!(await db.mailOutbox.findFirst({
          where: { id: outbox.id, deliveryRound: 1 },
        })),
    );

    const deferred = await db.mailOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
    });
    expect(deferred).toMatchObject({
      availableAt: retryAt,
      startedAt: attempted.startedAt,
      sendAttempts: 1,
    });
    const requests = send.mock.calls.filter(([, jobKey]) => jobKey === key);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });

  it("uses only the remaining attempt after a rate refusal and Redis job loss", async () => {
    await confirm();
    const db = app.get(PrismaService);
    const queue = mailQueue();
    const send = jest
      .spyOn(gateway, "send")
      .mockRejectedValueOnce(new MailRateLimitError(addMinutes(new Date(), 1)))
      .mockRejectedValue(new MailDeliveryError("Provider unavailable", 503));
    await queue.pause();
    const email = "retry-budget@mail.test";
    await signIn(app, { ...testCredentials, email });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const { id } = await db.mailOutbox.findFirstOrThrow({
      where: { userId: user.id },
    });
    await db.mailOutbox.update({
      where: { id },
      data: { sendAttempts: MAIL_SEND_ATTEMPTS - 1, startedAt: new Date() },
    });
    await queue.resume();
    const key = "confirm-" + id;
    await waitUntil(async () => (await queue.getJobState(key)) === "completed");
    const deferred = await db.mailOutbox.findUniqueOrThrow({ where: { id } });
    expect(deferred).toMatchObject({
      deliveryRound: 1,
      sendAttempts: MAIL_SEND_ATTEMPTS - 1,
    });
    expect(deferred.deliverySnapshot).toBeTruthy();
    await queue.remove(key);
    await db.mailOutbox.update({
      where: { id },
      data: { availableAt: new Date() },
    });
    await app.get(MailOutboxRelay).sweep();

    await waitUntil(
      async () => (await queue.getJobState(key + "-1")) === "failed",
    );
    expect(send.mock.calls.filter(([, jobKey]) => jobKey === key)).toHaveLength(
      2,
    );
    const failed = await db.mailOutbox.findUniqueOrThrow({ where: { id } });
    expect(failed.failedAt).toBeInstanceOf(Date);
    expect(failed).toMatchObject({
      lastError:
        "Mail delivery attempts exhausted: Mail provider returned HTTP 503",
      sendAttempts: MAIL_SEND_ATTEMPTS,
      deliverySnapshot: deferred.deliverySnapshot,
    });
  });

  it("recovers a failed Redis job after Postgres is available again", async () => {
    await confirm();
    const db = app.get(PrismaService);
    await db.user.update({
      where: { id: hostId },
      data: { emailVerifiedAt: null },
    });
    const task = { id: randomUUID(), kind: "confirm", userId: hostId };
    await db.mailOutbox.create({
      data: { ...task, availableAt: addMinutes(new Date(), 1) },
    });
    const jobId = "confirm-" + task.id;
    const queue = mailQueue();
    const begin = jest
      .spyOn(app.get(MailOutboxRepository), "begin")
      .mockRejectedValue(new Error("Postgres unavailable"));
    try {
      await queue.add(
        task.kind,
        { ...task, fromOutbox: true },
        { jobId, attempts: MAIL_SEND_ATTEMPTS },
      );
      await waitUntil(
        async () => (await queue.getJobState(jobId)) === "failed",
      );
      expect(begin).toHaveBeenCalledTimes(MAIL_SEND_ATTEMPTS);
      expect(
        await db.mailOutbox.findUniqueOrThrow({ where: { id: task.id } }),
      ).toMatchObject({ sendAttempts: 0 });
      expect(gateway.sent.has(jobId)).toBe(false);
    } finally {
      begin.mockRestore();
    }

    await db.mailOutbox.update({
      where: { id: task.id },
      data: { availableAt: new Date() },
    });
    await app.get(MailOutboxRelay).sweep();

    await waitUntil(
      async () => (await queue.getJobState(jobId)) === "completed",
    );
    expect(gateway.sent.get(jobId)?.to).toBe(address);
    expect(
      await db.mailOutbox.findUnique({ where: { id: task.id } }),
    ).toBeNull();
  });

  it("sets aside an exhausted outbox row when its last Redis job was lost", async () => {
    await confirm();
    const db = app.get(PrismaService);
    await db.user.update({
      where: { id: hostId },
      data: { emailVerifiedAt: null },
    });
    const { id } = await db.mailOutbox.create({
      data: {
        id: randomUUID(),
        kind: "confirm",
        userId: hostId,
        sendAttempts: MAIL_SEND_ATTEMPTS,
        startedAt: new Date(),
      },
    });
    const key = "confirm-" + id;
    const send = jest.spyOn(gateway, "send");
    await app.get(MailOutboxRelay).sweep();
    await waitUntil(
      async () => (await mailQueue().getJobState(key)) === "failed",
    );
    expect(send.mock.calls.filter(([, jobKey]) => jobKey === key)).toHaveLength(
      0,
    );
    const failed = await db.mailOutbox.findUniqueOrThrow({ where: { id } });
    expect(failed.failedAt).toBeInstanceOf(Date);
    expect(failed).toMatchObject({
      lastError: "Mail delivery attempts exhausted",
      sendAttempts: MAIL_SEND_ATTEMPTS,
    });
  });

  it.each([false, true])(
    "sets aside unreadable outbox payloads (expired: %s)",
    async (expired) => {
      await confirm();
      const db = app.get(PrismaService);
      const send = jest.spyOn(gateway, "send");
      const { id } = await db.mailOutbox.create({
        data: {
          id: randomUUID(),
          kind: "confirm",
          userId: hostId,
          sendAttempts: 1,
          startedAt: expired ? addDays(new Date(), -2) : new Date(),
          deliverySnapshot: "unreadable snapshot",
        },
      });
      const key = "confirm-" + id;
      await app.get(MailOutboxRelay).sweep();
      await waitUntil(
        async () => (await mailQueue().getJobState(key)) === "failed",
      );
      const failed = await db.mailOutbox.findUniqueOrThrow({ where: { id } });
      expect(failed.failedAt).toBeInstanceOf(Date);
      expect(failed).toMatchObject({
        lastError: expired
          ? "Mail delivery retry window expired"
          : "Stored mail delivery could not be read",
        deliverySnapshot: "unreadable snapshot",
      });
      expect(
        send.mock.calls.filter(([, jobKey]) => key === jobKey),
      ).toHaveLength(0);
    },
  );

  it.each(["outbox", "legacy"] as const)(
    "sends a first confirmation after a long pause (%s)",
    async (source) => {
      await confirm();
      const db = app.get(PrismaService);
      await db.user.update({
        where: { id: hostId },
        data: { emailVerifiedAt: null },
      });
      const task = { id: randomUUID(), kind: "confirm", userId: hostId };
      const key = "confirm-" + task.id;
      const past = addDays(new Date(), -2);
      if (source === "outbox") {
        await db.mailOutbox.create({ data: { ...task, startedAt: past } });
        await app.get(MailOutboxRelay).sweep();
      } else {
        await mailQueue().add(task.kind, task, {
          jobId: key,
          timestamp: past.getTime(),
        });
      }
      await waitUntil(
        async () => (await mailQueue().getJobState(key)) === "completed",
      );
      const token = tokenFrom(gateway.sent.get(key)?.text);
      expect(token).toBeDefined();
      await host.post("/mail/confirm").send({ token }).expect(204);
    },
  );

  it("retries a digest without waiting on a locked conversation or spending a send attempt", async () => {
    await confirm();
    await enableMail("messages");
    const { thread } = await startThread();
    const db = app.get(PrismaService);
    const { id } = await db.message.findFirstOrThrow({
      where: { conversationId: thread.id },
      select: { id: true },
    });
    const key = "digest-" + id;
    const queue = mailQueue();
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM conversations WHERE id = ${thread.id}::uuid FOR UPDATE
      `;
      await promoteDigests(1);
      await waitUntil(
        async () => (await queue.getJob(key))?.attemptsMade === 1,
      );
      expect((await queue.getJob(key))?.failedReason).toBe(
        "The conversation is busy",
      );
      expect(await db.mailOutbox.findUnique({ where: { id } })).toMatchObject({
        startedAt: null,
        sendAttempts: 0,
      });
    });
    await promoteDigests(1);
    await waitUntil(() => Promise.resolve(gateway.sent.has(key)));
  });

  it("coalesces quota-rejected digests with a fresh reply address after a long pause", async () => {
    await confirm();
    await enableMail("messages");
    const { guest, thread } = await startThread();
    await sendMessage(guest, thread.id, "Around noon?");
    const first = await firstMessageId(thread.id);
    const jobId = "digest-" + first;
    const db = app.get(PrismaService);
    const retryAt = addDays(new Date(), 8);
    const send = jest
      .spyOn(gateway, "send")
      .mockRejectedValueOnce(new MailQuotaError(retryAt));

    await promoteDigest(first);
    await waitUntil(
      async () =>
        !!(await db.mailOutbox.findFirst({
          where: { id: first, deliveryRound: 1, startedAt: null },
        })),
    );
    const firstRequest = send.mock.calls.find(([, key]) => key === jobId)?.[0];
    if (!firstRequest) throw new Error("Missing quota-rejected digest");
    const firstLetter = readMailRequest(firstRequest);
    const oldHash = firstLetter.replyTo && replyTokenHash(firstLetter.replyTo);
    if (!oldHash) throw new Error("Missing reply token");
    expect(firstLetter.text).toContain("2 unread messages");
    const token = await db.mailReplyToken.findUniqueOrThrow({
      where: { hash: oldHash },
    });
    expect(token.expiresAt.getTime()).toBeLessThan(retryAt.getTime());

    const latest = await sendMessage(guest, thread.id, "Use the side door.");
    // Older workers could leave a separate deferred digest for this message.
    await db.mailOutbox.update({
      where: { id: latest.id },
      data: { availableAt: retryAt, deliveryRound: 1 },
    });

    await host
      .post("/conversations/" + thread.id + "/read")
      .send({ upTo: thread.lastMessage.createdAt })
      .expect(204);
    await db.mailReplyToken.update({
      where: { hash: oldHash },
      data: { expiresAt: new Date(0) },
    });
    await db.mailOutbox.update({
      where: { id: first },
      data: { availableAt: new Date(), createdAt: new Date(0) },
    });
    await app.get(MailOutboxRelay).sweep();
    await waitUntil(() => Promise.resolve(gateway.sent.has(jobId)));

    const letter = gateway.sent.get(jobId);
    expect(letter?.text).toContain("2 unread messages\n");
    expect(letter?.text).toContain(latest.body);
    expect(letter?.replyTo).not.toBe(firstLetter.replyTo);
    expect(
      await db.mailOutbox.findUnique({ where: { id: latest.id } }),
    ).toBeNull();
    const newHash = letter?.replyTo && replyTokenHash(letter.replyTo);
    if (!newHash) throw new Error("Missing renewed reply token");
    expect(
      await app.get(MailRepository).replyTarget(newHash, new Date()),
    ).toMatchObject({
      threadId: thread.id,
      user: { id: hostId },
    });
  });

  it("retries the same digest after the reader advances the read marker", async () => {
    await confirm();
    await enableMail("messages");
    const { guest, thread } = await startThread();
    await sendMessage(guest, thread.id, "Around noon?");
    const first = await firstMessageId(thread.id);
    const jobId = "digest-" + first;
    const queue = mailQueue();
    const send = jest
      .spyOn(gateway, "send")
      .mockRejectedValueOnce(
        new Error("The provider accepted but did not answer"),
      );

    await promoteDigest(first);
    await waitUntil(
      async () =>
        send.mock.calls.some(([, key]) => key === jobId) &&
        (await queue.getJobState(jobId)) === "delayed",
    );
    await host
      .post("/conversations/" + thread.id + "/read")
      .send({ upTo: thread.lastMessage.createdAt })
      .expect(204);
    await promoteDigest(first);
    await waitUntil(() => Promise.resolve(gateway.sent.has(jobId)));

    const requests = send.mock.calls.filter(([, key]) => key === jobId);
    expect(requests).toHaveLength(2);
    const original = requests[0]?.[0];
    expect(original && readMailRequest(original).text).toContain(
      "2 unread messages",
    );
    expect(requests[1]).toEqual(requests[0]);
  });

  it("skips a digest when its message was read before the attempt", async () => {
    await confirm();
    await enableMail("messages");
    const { guest, thread } = await startThread();
    const first = await firstMessageId(thread.id);
    const latest = await sendMessage(guest, thread.id, "Around noon?");
    const key = "digest-" + first;
    const repo = app.get(MailRepository);
    const start = repo.startDigest.bind(repo);
    jest.spyOn(repo, "startDigest").mockImplementationOnce(async (...args) => {
      await host
        .post("/conversations/" + thread.id + "/read")
        .send({ upTo: thread.lastMessage.createdAt })
        .expect(204);
      return start(...args);
    });

    await promoteDigest(first);
    await waitUntil(
      async () => (await mailQueue().getJobState(key)) === "completed",
    );
    expect(gateway.sent.has(key)).toBe(false);
    await promoteDigest(latest.id);
    const latestKey = "digest-" + latest.id;
    await waitUntil(() => Promise.resolve(gateway.sent.has(latestKey)));
    expect(gateway.sent.get(latestKey)?.text).toContain("1 unread message\n");
  });

  it("sends a digest without a reply address after the other participant erases their account", async () => {
    await confirm();
    await enableMail("messages");
    const { guest, thread } = await startThread();
    const id = await firstMessageId(thread.id);
    await guest
      .delete("/users/me")
      .send({ password: testCredentials.password })
      .expect(204);

    await promoteDigest(id);
    const key = "digest-" + id;
    await waitUntil(() => Promise.resolve(gateway.sent.has(key)));
    expect(gateway.sent.get(key)?.replyTo).toBeUndefined();
    expect(await app.get(PrismaService).mailReplyToken.count()).toBe(0);
  });

  it("keeps a newer guest message unread and emails its digest when the host replies to an earlier digest", async () => {
    await confirm();
    await enableMail("messages");
    const { guest, thread } = await startThread();
    await promoteDigests(1);
    await waitUntil(() =>
      Promise.resolve(
        [...gateway.sent.values()].some((letter) => letter.replyTo),
      ),
    );
    const replyTo = [...gateway.sent.values()].find(
      (letter) => letter.replyTo,
    )?.replyTo;
    if (!replyTo) throw new Error("Missing reply address");
    const newer = await sendMessage(
      guest,
      thread.id,
      "Please use the side door.",
    );
    const emailId = randomUUID();
    const to = ["host@mail.test"];
    gateway.received.set(emailId, {
      to,
      received_for: [replyTo],
      text:
        "Noon works.\n\nOn Sunday,\nStayDesk wrote:\n" +
        "Earlier mail. ".repeat(160),
    });
    const eventId = randomUUID();
    await webhook(
      "email.received",
      { to, received_for: [replyTo] },
      emailId,
      eventId,
    ).expect(200);
    await waitForEvent(eventId);
    const path = "/conversations/" + thread.id;

    const readThread = async () =>
      conversationSchema.parse((await host.get(path).expect(200)).body);

    expect(await readThread()).toMatchObject({
      unread: true,
      lastMessage: { sender: "HOST", body: "Noon works." },
    });
    await promoteDigests(2);
    const key = "digest-" + newer.id;
    await waitUntil(() => Promise.resolve(gateway.sent.has(key)));
    expect(gateway.sent.get(key)?.text).toContain(
      "1 unread message\n\nPlease use the side door.",
    );
    await host
      .post(path + "/read")
      .send({ upTo: newer.createdAt })
      .expect(204);
    expect((await readThread()).unread).toBe(false);

    const secondReply = randomUUID();
    gateway.received.set(secondReply, {
      to,
      received_for: [replyTo],
      text: "Thanks.",
    });
    const legacyEvent = randomUUID();
    await webhook("email.received", [], secondReply, legacyEvent).expect(200);
    await waitForEvent(legacyEvent);
    expect(await readThread()).toMatchObject({
      unread: false,
      lastMessage: { body: "Thanks." },
    });

    const otherToken = gateway.sent.get(key)?.replyTo;
    if (!otherToken) throw new Error("Missing second reply address");
    const ambiguous = randomUUID();
    await webhook(
      "email.received",
      { to, bcc: [otherToken], received_for: [replyTo] },
      randomUUID(),
      ambiguous,
    ).expect(200);
    expect(
      await app
        .get(PrismaService)
        .mailEvent.findUnique({ where: { id: ambiguous } }),
    ).toBeNull();
  });

  it("coalesces unread messages and posts a signed email reply only once as the recipient", async () => {
    await confirm();
    await enableMail("messages");
    const { guest, thread } = await startThread();
    const message = await sendMessage(guest, thread.id, "Around noon?");
    const first = await firstMessageId(thread.id);
    const db = app.get(PrismaService);
    const key = "digest-" + first;
    await promoteDigest(first);
    await waitUntil(
      async () => (await mailQueue().getJobState(key)) === "completed",
    );
    const letter = gateway.sent.get(key);
    expect(letter?.text).toContain("2 unread messages");
    expect(letter?.text).toContain("Around noon?");
    expect(
      await db.mailOutbox.findUnique({ where: { id: message.id } }),
    ).toBeNull();
    await promoteDigest(message.id);
    await waitUntil(
      async () =>
        (await mailQueue().getJobState("digest-" + message.id)) === "completed",
    );
    const replyTo = letter?.replyTo;
    if (!replyTo) throw new Error("Missing reply address");
    const hash = replyTokenHash(replyTo);
    if (!hash) throw new Error("Missing stored reply token hash");
    expect(gateway.sent.size).toBe(2);

    const auto = randomUUID();
    gateway.received.set(auto, {
      to: [replyTo],
      text: "Out of office",
      headers: { "Auto-Submitted": "auto-replied" },
    });
    const automaticEvent = randomUUID();
    await webhook("email.received", [replyTo], auto, automaticEvent).expect(
      200,
    );
    await waitForEvent(automaticEvent);
    expect(await db.message.count({ where: { inboundEmailId: auto } })).toBe(0);

    const emailId = randomUUID();
    gateway.received.set(emailId, {
      to: [replyTo],
      text: "Noon works.\n\nVon: StayDesk\n" + "Earlier mail. ".repeat(200),
      html: '<p>Noon works.</p><div class="gmail_signature">Team</div><blockquote>Around noon?</blockquote>',
    });
    const inbox = app.get(MailInbox);
    const pause = jest.spyOn(inbox, "sweep").mockResolvedValue(undefined);
    const events = [randomUUID(), randomUUID()];
    await Promise.all(
      events.map((id) =>
        webhook("email.received", [replyTo], emailId, id).expect(200),
      ),
    );
    const pending = await db.mailEvent.findMany({
      where: { emailId, processedAt: null },
      select: { recipientIds: true, replyTokenHash: true },
    });
    expect(pending).toEqual([
      { recipientIds: [], replyTokenHash: hash },
      { recipientIds: [], replyTokenHash: hash },
    ]);
    expect(await db.message.count({ where: { inboundEmailId: emailId } })).toBe(
      0,
    );
    pause.mockRestore();
    jest
      .spyOn(gateway, "receive")
      .mockRejectedValueOnce(new Error("Temporary provider outage"));
    await inbox.sweep();
    expect(
      await db.mailEvent.count({ where: { emailId, processedAt: null } }),
    ).toBe(1);
    await db.mailEvent.updateMany({
      where: { emailId, processedAt: null },
      data: { availableAt: new Date() },
    });
    await inbox.sweep();
    expect(
      await db.mailEvent.count({ where: { emailId, processedAt: null } }),
    ).toBe(0);
    const messages = messagePageSchema.parse(
      (await host.get("/conversations/" + thread.id + "/messages")).body,
    );
    expect(messages.items).toHaveLength(3);
    expect(messages.items[0]).toMatchObject({
      sender: "HOST",
      body: "Noon works.",
    });
    const conversation = conversationSchema.parse(
      (await host.get("/conversations/" + thread.id).expect(200)).body,
    );
    expect(conversation.unread).toBe(true);
    expect(
      await db.conversation.findUnique({
        where: { id: thread.id },
        select: { hostReadAt: true },
      }),
    ).toEqual({ hostReadAt: null });

    const expired = randomUUID();
    await db.mailReplyToken.update({
      where: { hash },
      data: { expiresAt: new Date(0) },
    });
    const expiredEvent = randomUUID();
    await webhook("email.received", [replyTo], expired, expiredEvent).expect(
      200,
    );
    await waitForEvent(expiredEvent);
    expect(await db.message.count({ where: { inboundEmailId: expired } })).toBe(
      0,
    );

    const revoked = randomUUID();
    gateway.received.set(revoked, { to: [replyTo], text: "Another reply" });
    await db.mailReplyToken.update({
      where: { hash },
      data: { expiresAt: new Date(Date.now() + 60_000) },
    });
    const receive = gateway.receive.bind(gateway);
    jest.spyOn(gateway, "receive").mockImplementationOnce(async (id) => {
      await db.mailReplyToken.update({
        where: { hash },
        data: { revokedAt: new Date() },
      });
      return receive(id);
    });
    const revokedEvent = randomUUID();
    await webhook("email.received", [replyTo], revoked, revokedEvent).expect(
      200,
    );
    await waitForEvent(revokedEvent);
    expect(await db.message.count({ where: { inboundEmailId: revoked } })).toBe(
      0,
    );
  });

  it("posts a reply received before expiry even when processing starts after expiry", async () => {
    await confirm();
    await enableMail("messages");
    const { guest, thread } = await startThread();
    const db = app.get(PrismaService);
    const message = await db.message.findFirstOrThrow({
      where: { conversationId: thread.id },
    });
    const key = "digest-" + message.id;
    await promoteDigests(1);
    await waitUntil(() => Promise.resolve(gateway.sent.has(key)));
    const replyTo = gateway.sent.get(key)?.replyTo;
    const hash = replyTo && replyTokenHash(replyTo);
    if (!replyTo || !hash) throw new Error("Missing stored reply token");

    const inbox = app.get(MailInbox);
    const receivedAt = subDays(new Date(), 3);
    const expiry = addMinutes(receivedAt, 1);
    await db.mailReplyToken.update({
      where: { hash },
      data: { expiresAt: expiry },
    });
    const pause = jest.spyOn(inbox, "sweep").mockResolvedValue(undefined);
    const emailId = randomUUID();
    gateway.received.set(emailId, { to: [replyTo], text: "Noon works." });
    await webhook(
      "email.received",
      [replyTo],
      emailId,
      randomUUID(),
      true,
      new Date(),
      receivedAt,
    ).expect(200);
    const newer = await sendMessage(guest, thread.id, "Which door?");
    await promoteDigest(newer.id);
    await waitUntil(() =>
      Promise.resolve(gateway.sent.has("digest-" + newer.id)),
    );
    pause.mockRestore();
    await inbox.sweep();
    expect(
      await db.message.findUnique({ where: { inboundEmailId: emailId } }),
    ).toMatchObject({ sender: "HOST", body: "Noon works." });
  });

  it("acknowledges a reply that Resend received above quota without fetching it again", async () => {
    const receive = jest
      .spyOn(gateway, "receive")
      .mockRejectedValue(new InboundMailAboveQuotaError());
    const emailId = randomUUID();
    const eventId = randomUUID();
    await webhook("email.received", [], emailId, eventId).expect(200);
    await waitForEvent(eventId);
    await webhook("email.received", [], emailId, eventId).expect(200);
    await app.get(MailInbox).sweep();

    expect(receive.mock.calls).toEqual([[emailId]]);
    const db = app.get(PrismaService);
    const event = await db.mailEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    expect(event.attempts).toBe(1);
    expect(await db.message.count({ where: { inboundEmailId: emailId } })).toBe(
      0,
    );
  });
});
