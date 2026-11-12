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
        cancellationPolicy: "FLEXIBLE",
        timeZone: "UTC",
        checkInTime: "00:00",
        // Midnight UTC of `from`, as `checkInData` makes it of the two above.
        checkInAt: parseISO(inDays(-10), { in: tz("UTC") }),
        discountCents: 0,
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

    it("narrows by the event's id, a part of its type and the days it was set aside", async () => {
      await prismaService.paymentEvent.create({
        data: {
          id: "evt_dispute",
          type: "charge.dispute.created",
          payload: {
            kind: "other",
            eventId: "evt_dispute",
            type: "charge.dispute.created",
          },
          attempts: 24,
          failedAt: new Date("2026-10-27T08:00:00.000Z"),
        },
      });

      const ids = async (search: string) =>
        failedPaymentEventPageSchema
          .parse(
            (await admin.get(`/payment-events/failed?${search}`).expect(200))
              .body,
          )
          .items.map(({ id }) => id);

      expect(await ids("eventId=evt_failed")).toEqual(["evt_failed"]);
      expect(await ids("eventId=evt_pending")).toEqual([]);
      expect(await ids("type=DISPUTE")).toEqual(["evt_dispute"]);
      // `_` is a character of the type, not a wildcard of `LIKE`.
      expect(await ids("type=customer_created")).toEqual([]);
      expect(await ids("from=2026-10-26")).toEqual(["evt_dispute"]);
      expect(await ids("to=2026-10-25")).toEqual(["evt_failed"]);
      expect(await ids("from=2026-10-25&to=2026-10-25")).toEqual([
        "evt_failed",
      ]);
      await admin
        .get("/payment-events/failed?from=2026-10-26&to=2026-10-25")
        .expect(400);
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

    it("narrows by the refund, the payment, the stay and its people, and the days", async () => {
      const { listingId, guestId, listing } =
        await prismaService.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: { listing: true },
        });
      const refundIds = async (search: string) =>
        refundFailurePageSchema
          .parse(
            (await admin.get(`/refund-failures?${search}`).expect(200)).body,
          )
          .items.map(({ refundId }) => refundId);

      expect(await refundIds("refundId=re_orphan")).toEqual(["re_orphan"]);
      expect(await refundIds("paymentId=pi_stay")).toEqual(["re_stay"]);
      expect(await refundIds(`bookingId=${bookingId}`)).toEqual(["re_stay"]);
      expect(await refundIds(`listingId=${listingId}`)).toEqual(["re_stay"]);
      expect(await refundIds(`guestId=${guestId}`)).toEqual(["re_stay"]);
      expect(await refundIds(`hostId=${listing.ownerId}`)).toEqual(["re_stay"]);
      expect(await refundIds(`hostId=${randomUUID()}`)).toEqual([]);
      expect(await refundIds("from=2026-10-25")).toEqual(["re_stay"]);
      expect(await refundIds("to=2026-10-24")).toEqual(["re_orphan"]);
      // An open refund is not on the resolved half, whatever names it.
      expect(await refundIds("status=RESOLVED&refundId=re_orphan")).toEqual([]);
      await admin.get("/refund-failures?listingId=not-a-uuid").expect(400);
    });

    it("pages a narrowed list under the same filters", async () => {
      await prismaService.refundFailure.create({
        data: {
          refundId: "re_stay_again",
          paymentId: "pi_stay",
          bookingId,
          amountCents: 4000,
          currency: "usd",
          reason: null,
          failedAt: new Date("2026-10-23T12:00:00.000Z"),
        },
      });

      const page = async (search: string) =>
        refundFailurePageSchema.parse(
          (
            await admin
              .get(`/refund-failures?limit=1&bookingId=${bookingId}${search}`)
              .expect(200)
          ).body,
        );
      const first = await page("");
      const second = await page(`&cursor=${first.nextCursor ?? ""}`);

      expect(first.items.map(({ refundId }) => refundId)).toEqual(["re_stay"]);
      // The orphan between them in time is not the stay's, so the list ends here.
      expect(second.items.map(({ refundId }) => refundId)).toEqual([
        "re_stay_again",
      ]);
      expect(second.nextCursor).toBeNull();
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
        },
      });

      // A stay owed a refund is no payout to retry, so the payout is another stay's.
      const { listingId, guestId } =
        await prismaService.booking.findUniqueOrThrow({
          where: { id: bookingId },
        });
      const payout = await prismaService.booking.create({
        data: {
          listingId,
          guestId,
          from: parseISO(inDays(-20), { in: tz("UTC") }),
          to: parseISO(inDays(-16), { in: tz("UTC") }),
          status: "CONFIRMED",
          amountCents: 48_000,
          currency: "usd",
          cancellationPolicy: "FLEXIBLE",
          timeZone: "UTC",
          checkInTime: "00:00",
          // Midnight UTC of `from`, as `checkInData` makes it of the two above.
          checkInAt: parseISO(inDays(-20), { in: tz("UTC") }),
          discountCents: 0,
          paidAt: new Date(),
          refundedAmountCents: 12_000,
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
          owedCents: 48_000,
          attempts: 30,
          lastError: "Error: api_connection_error",
          failedAt: "2026-10-25T12:00:00.000Z",
        }),
      ]);
      expect(refunds.items[0]?.booking).toMatchObject({
        id: bookingId,
        refundOwedCents: 48_000,
      });
      // 85% of the 36 000 cents the guest kept paying.
      expect(payouts.items).toEqual([
        expect.objectContaining({
          kind: "payout",
          owedCents: 30_600,
          attempts: 24,
          lastError: "Error: The transfer was refused",
          failedAt: "2026-10-26T12:00:00.000Z",
        }),
      ]);
      expect(payouts.items[0]?.booking.id).toBe(payout.id);
      await admin.get("/bookings/stuck").expect(400);

      // A cursor naming an id no stay could have is refused before the query sees it.
      const forged = Buffer.from(
        "bookings-stuck-refund|newest|2026-10-25T12:00:00.000Z|evt_1",
      ).toString("base64url");

      await admin
        .get(`/bookings/stuck?kind=refund&cursor=${forged}`)
        .expect(400);
    });

    it("narrows the stuck stays by the stay, its people and the days", async () => {
      await prismaService.booking.update({
        where: { id: bookingId },
        data: {
          refundOwedCents: 48_000,
          refundAttempts: 30,
          refundFailedAt: new Date("2026-10-25T12:00:00.000Z"),
        },
      });

      const { listingId, guestId, listing } =
        await prismaService.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: { listing: true },
        });
      const stuckIds = async (search: string) =>
        stuckStayPageSchema
          .parse(
            (
              await admin
                .get(`/bookings/stuck?kind=refund&${search}`)
                .expect(200)
            ).body,
          )
          .items.map(({ booking }) => booking.id);

      expect(await stuckIds(`bookingId=${bookingId}`)).toEqual([bookingId]);
      expect(await stuckIds(`bookingId=${randomUUID()}`)).toEqual([]);
      expect(await stuckIds(`listingId=${listingId}`)).toEqual([bookingId]);
      expect(await stuckIds(`guestId=${guestId}`)).toEqual([bookingId]);
      expect(await stuckIds(`hostId=${listing.ownerId}`)).toEqual([bookingId]);
      expect(await stuckIds(`guestId=${listing.ownerId}`)).toEqual([]);
      expect(await stuckIds("from=2026-10-25&to=2026-10-25")).toEqual([
        bookingId,
      ]);
      expect(await stuckIds("from=2026-10-26")).toEqual([]);
    });

    it("narrows the stuck payouts the same way, by the day the payout was set aside", async () => {
      await prismaService.booking.update({
        where: { id: bookingId },
        data: {
          payoutAttempts: 24,
          payoutFailedAt: new Date("2026-10-26T12:00:00.000Z"),
          // The refund's stamp is another day, and no window over payouts reads it.
          refundAttempts: 30,
          refundFailedAt: new Date("2026-10-25T12:00:00.000Z"),
        },
      });

      const { listingId, listing } =
        await prismaService.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: { listing: true },
        });
      const stuckIds = async (search: string) =>
        stuckStayPageSchema
          .parse(
            (
              await admin
                .get(`/bookings/stuck?kind=payout&${search}`)
                .expect(200)
            ).body,
          )
          .items.map(({ booking }) => booking.id);

      expect(await stuckIds(`bookingId=${bookingId}`)).toEqual([bookingId]);
      expect(await stuckIds(`listingId=${listingId}`)).toEqual([bookingId]);
      expect(await stuckIds(`hostId=${listing.ownerId}`)).toEqual([bookingId]);
      expect(await stuckIds(`hostId=${randomUUID()}`)).toEqual([]);
      expect(await stuckIds("from=2026-10-26&to=2026-10-26")).toEqual([
        bookingId,
      ]);
      expect(await stuckIds("to=2026-10-25")).toEqual([]);
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

      // A refund still on its way is sent first; the payout waits for it to be recorded.
      await prismaService.booking.update({
        where: { id: bookingId },
        data: { refundOwedCents: 1 },
      });

      expect(await listPayouts()).toEqual([]);
      await admin.post(`/bookings/${bookingId}/stuck/payout/retry`).expect(409);

      await prismaService.booking.update({
        where: { id: bookingId },
        data: { refundOwedCents: null, refundedAmountCents: 48_000 },
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
