import { randomUUID } from "node:crypto";
import { tz } from "@date-fns/tz";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { parseISO } from "date-fns";
import request from "supertest";
import { App } from "supertest/types";
import {
  DisputeStatus,
  Role,
  failedPaymentEventPageSchema,
  refundFailurePageSchema,
  stuckStayPageSchema,
} from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { resetQueue } from "./queue";
import { signInAs, type Agent } from "./session";

/**
 * What the money paths set aside, as an admin reads and acts on it — the SQL the unit specs
 * fake: the partial indexes' conditions, the join to the stay, and the conditional writes
 * that hand a row back.
 */
describe("What the money paths set aside (e2e)", () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;
  let admin: Agent;
  let user: Agent;
  let bookingId: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prismaService = app.get(PrismaService);

    await resetDatabase(app);
    await resetQueue(app);

    admin = await signInAs(app, Role.ADMIN);
    user = await signInAs(app, Role.USER);

    const guest = await prismaService.user.create({
      data: {
        name: "Stuck Guest",
        email: "stuck-guest@example.com",
        passwordHash: "hash",
      },
    });
    const host = await prismaService.user.create({
      data: {
        name: "Stuck Host",
        email: "stuck-host@example.com",
        passwordHash: "hash",
      },
    });
    const listing = await prismaService.listing.create({
      data: {
        ownerId: host.id,
        title: "Cabin by the lake",
        description: "Two rooms, a jetty and no neighbours.",
        pricePerNightCents: 12_000,
        capacity: 4,
      },
    });
    // No payment and no charge, so a job a retry queues finds nothing to send to Stripe.
    const booking = await prismaService.booking.create({
      data: {
        listingId: listing.id,
        guestId: guest.id,
        from: parseISO(inDays(-10), { in: tz("UTC") }),
        to: parseISO(inDays(-6), { in: tz("UTC") }),
        status: "CONFIRMED",
        amountCents: 48_000,
        currency: "usd",
        paidAt: new Date(),
      },
    });

    bookingId = booking.id;
  });

  afterEach(async () => {
    await app.close();
  });

  it("is the admin's alone", async () => {
    await user.get("/payment-events/failed").expect(403);
    await user.post("/payment-events/evt_1/retry").expect(403);
    await user.get("/refund-failures").expect(403);
    await user
      .post("/refund-failures/re_1/resolve")
      .send({ resolution: "Paid back" })
      .expect(403);
    await user.get("/bookings/stuck?kind=refund").expect(403);
    await user.post(`/bookings/${bookingId}/stuck/refund/retry`).expect(403);
    await user.post(`/bookings/${bookingId}/stuck/payout/retry`).expect(403);
    await request(app.getHttpServer()).get("/refund-failures").expect(401);
  });

  describe("payment events", () => {
    const failedAt = new Date("2026-10-25T12:00:00.000Z");

    beforeEach(async () => {
      await prismaService.paymentEvent.createMany({
        data: [
          {
            id: "evt_failed",
            type: "customer.created",
            payload: {
              kind: "other",
              eventId: "evt_failed",
              type: "customer.created",
            },
            attempts: 24,
            lastError: "Error: api_connection_error",
            failedAt,
          },
          {
            id: "evt_pending",
            type: "customer.created",
            payload: {
              kind: "other",
              eventId: "evt_pending",
              type: "customer.created",
            },
            attempts: 3,
          },
        ],
      });
    });

    it("lists the events set aside and nothing still being retried", async () => {
      const page = failedPaymentEventPageSchema.parse(
        (await admin.get("/payment-events/failed").expect(200)).body,
      );

      expect(page).toEqual({
        items: [
          {
            id: "evt_failed",
            type: "customer.created",
            attempts: 24,
            lastError: "Error: api_connection_error",
            receivedAt: expect.any(String) as string,
            failedAt: failedAt.toISOString(),
          },
        ],
        nextCursor: null,
      });
    });

    it("hands an event back to the worker with a whole count", async () => {
      await admin.post("/payment-events/evt_failed/retry").expect(204);

      expect(
        await prismaService.paymentEvent.findUniqueOrThrow({
          where: { id: "evt_failed" },
        }),
      ).toMatchObject({ failedAt: null, attempts: 0 });
      await admin.post("/payment-events/evt_failed/retry").expect(409);
      await admin.post("/payment-events/evt_pending/retry").expect(409);
      await admin.post("/payment-events/evt_unknown/retry").expect(404);
    });
  });

  describe("refund failures", () => {
    beforeEach(async () => {
      await prismaService.refundFailure.createMany({
        data: [
          {
            refundId: "re_stay",
            paymentId: "pi_stay",
            bookingId,
            amountCents: 12_035,
            currency: "usd",
            reason: "expired_or_canceled_card",
            failedAt: new Date("2026-10-25T12:00:00.000Z"),
          },
          {
            refundId: "re_orphan",
            paymentId: "pi_orphan",
            amountCents: 8000,
            currency: "usd",
            reason: null,
            failedAt: new Date("2026-10-24T12:00:00.000Z"),
          },
        ],
      });
    });

    it("lists the open ones newest first, each with the stay it belongs to", async () => {
      const page = refundFailurePageSchema.parse(
        (await admin.get("/refund-failures").expect(200)).body,
      );

      expect(page.items.map(({ refundId }) => refundId)).toEqual([
        "re_stay",
        "re_orphan",
      ]);
      expect(page.items[0]).toMatchObject({
        amountCents: 12_035,
        stay: {
          bookingId,
          listingTitle: "Cabin by the lake",
          from: inDays(-10),
          to: inDays(-6),
        },
      });
      expect(page.items[1]?.stay).toBeNull();
    });

    it("pages by a cursor of its own", async () => {
      const first = refundFailurePageSchema.parse(
        (await admin.get("/refund-failures?limit=1").expect(200)).body,
      );
      const second = refundFailurePageSchema.parse(
        (
          await admin
            .get(`/refund-failures?limit=1&cursor=${first.nextCursor ?? ""}`)
            .expect(200)
        ).body,
      );

      expect(second.items.map(({ refundId }) => refundId)).toEqual([
        "re_orphan",
      ]);
      expect(second.nextCursor).toBeNull();
    });

    it("records how the money went back, once, and moves it to the resolved list", async () => {
      await admin
        .post("/refund-failures/re_stay/resolve")
        .send({ resolution: "  " })
        .expect(400);
      await admin
        .post("/refund-failures/re_stay/resolve")
        .send({ resolution: "Sent by bank transfer" })
        .expect(204);
      await admin
        .post("/refund-failures/re_stay/resolve")
        .send({ resolution: "Paid in cash" })
        .expect(409);
      await admin
        .post("/refund-failures/re_unknown/resolve")
        .send({ resolution: "Paid in cash" })
        .expect(404);

      const resolved = refundFailurePageSchema.parse(
        (await admin.get("/refund-failures?status=RESOLVED").expect(200)).body,
      );

      expect(resolved.items).toEqual([
        expect.objectContaining({
          refundId: "re_stay",
          resolution: "Sent by bank transfer",
          resolvedAt: expect.any(String) as string,
        }),
      ]);
    });

    it("refuses a resolution or a resolved moment written without the other", async () => {
      await expect(
        prismaService.refundFailure.update({
          where: { refundId: "re_orphan" },
          data: { resolvedAt: new Date() },
        }),
      ).rejects.toThrow();
    });
  });

  describe("stuck stays", () => {
    it("lists a refund set aside and a payout set aside, each under its own kind", async () => {
      await prismaService.booking.update({
        where: { id: bookingId },
        data: {
          refundOwedCents: 48_000,
          refundAttempts: 30,
          refundLastError: "Error: api_connection_error",
          refundFailedAt: new Date("2026-10-25T12:00:00.000Z"),
          payoutAttempts: 24,
          payoutLastError: "Error: The transfer was refused",
          payoutFailedAt: new Date("2026-10-26T12:00:00.000Z"),
        },
      });

      const refunds = stuckStayPageSchema.parse(
        (await admin.get("/bookings/stuck?kind=refund").expect(200)).body,
      );
      const payouts = stuckStayPageSchema.parse(
        (await admin.get("/bookings/stuck?kind=payout").expect(200)).body,
      );

      expect(refunds.items).toEqual([
        expect.objectContaining({
          kind: "refund",
          attempts: 30,
          lastError: "Error: api_connection_error",
          failedAt: "2026-10-25T12:00:00.000Z",
        }),
      ]);
      expect(refunds.items[0]?.booking).toMatchObject({
        id: bookingId,
        refundOwedCents: 48_000,
      });
      expect(payouts.items).toEqual([
        expect.objectContaining({ kind: "payout", attempts: 24 }),
      ]);
      await admin.get("/bookings/stuck").expect(400);

      // A cursor naming an id no stay could have is refused before the query sees it.
      const forged = Buffer.from(
        "bookings-stuck-refund|newest|2026-10-25T12:00:00.000Z|evt_1",
      ).toString("base64url");

      await admin
        .get(`/bookings/stuck?kind=refund&cursor=${forged}`)
        .expect(400);
    });

    it("leaves out a payout set aside that nothing is owed on any more", async () => {
      const listPayouts = async () =>
        stuckStayPageSchema.parse(
          (await admin.get("/bookings/stuck?kind=payout").expect(200)).body,
        ).items;

      await prismaService.booking.update({
        where: { id: bookingId },
        data: {
          payoutAttempts: 24,
          payoutFailedAt: new Date("2026-10-26T12:00:00.000Z"),
          refundedAmountCents: 47_999,
        },
      });

      expect(await listPayouts()).toHaveLength(1);

      await prismaService.booking.update({
        where: { id: bookingId },
        data: { refundedAmountCents: 48_000 },
      });

      expect(await listPayouts()).toEqual([]);

      await prismaService.booking.update({
        where: { id: bookingId },
        data: { refundedAmountCents: null, disputeStatus: "LOST" },
      });

      expect(await listPayouts()).toEqual([]);

      // Nothing leaves under an open dispute, so the list waits for its outcome.
      await prismaService.booking.update({
        where: { id: bookingId },
        data: { disputeStatus: "OPEN" },
      });

      expect(await listPayouts()).toEqual([]);

      await prismaService.booking.update({
        where: { id: bookingId },
        data: { disputeStatus: "WON" },
      });

      expect(await listPayouts()).toHaveLength(1);
    });

    it("hands a refund back to its sweep, and refuses one not set aside", async () => {
      await admin.post(`/bookings/${bookingId}/stuck/refund/retry`).expect(409);

      await prismaService.booking.update({
        where: { id: bookingId },
        data: {
          refundOwedCents: 48_000,
          refundAttempts: 30,
          refundFailedAt: new Date(),
        },
      });

      await admin.post(`/bookings/${bookingId}/stuck/refund/retry`).expect(204);

      expect(
        await prismaService.booking.findUniqueOrThrow({
          where: { id: bookingId },
        }),
      ).toMatchObject({ refundFailedAt: null, refundAttempts: 0 });
      await admin
        .post(`/bookings/${randomUUID()}/stuck/refund/retry`)
        .expect(404);
    });

    it("hands a payout back, and refuses one not set aside", async () => {
      await admin.post(`/bookings/${bookingId}/stuck/payout/retry`).expect(409);

      await prismaService.booking.update({
        where: { id: bookingId },
        data: { payoutAttempts: 24, payoutFailedAt: new Date() },
      });

      await admin.post(`/bookings/${bookingId}/stuck/payout/retry`).expect(204);

      expect(
        await prismaService.booking.findUniqueOrThrow({
          where: { id: bookingId },
        }),
      ).toMatchObject({ payoutFailedAt: null, payoutAttempts: 0 });
      await admin
        .post(`/bookings/${randomUUID()}/stuck/payout/retry`)
        .expect(404);
    });

    it("refuses a payout a lost dispute left owing nothing, as the list leaves it out", async () => {
      await prismaService.booking.update({
        where: { id: bookingId },
        data: {
          payoutAttempts: 24,
          payoutFailedAt: new Date(),
          disputeStatus: DisputeStatus.LOST,
        },
      });

      const payouts = stuckStayPageSchema.parse(
        (await admin.get("/bookings/stuck?kind=payout").expect(200)).body,
      );

      expect(payouts.items).toEqual([]);
      await admin.post(`/bookings/${bookingId}/stuck/payout/retry`).expect(409);

      const row = await prismaService.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });

      expect(row.payoutAttempts).toBe(24);
      expect(row.payoutFailedAt).not.toBeNull();
    });
  });
});
