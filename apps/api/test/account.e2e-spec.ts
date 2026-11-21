import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { App } from "supertest/types";
import {
  ACCESS_TOKEN_COOKIE,
  BookingStatus,
  DELETED_USER_NAME,
  DisputeStatus,
  Role,
  apiErrorSchema,
  bookingSchema,
  conversationPageSchema,
  managedUserSchema,
  openMattersParamsSchema,
  userPageSchema,
  type CreateListingInput,
  type OpenMatter,
  type OpenMattersParams,
} from "@repo/contracts";
import { placeholderEmail } from "./../src/account/account.repository";
import { AppModule } from "./../src/app.module";
import { cents } from "./../src/payment/domain/money";
import { PayoutRepository } from "./../src/payout/infrastructure/payout.repository";
import { PrismaService } from "./../src/prisma/prisma.service";
import { hasCode, issueCodesOf } from "./api-error";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { resetQueue } from "./queue";
import {
  credentialsFor,
  hostCredentials,
  readSetCookie,
  signIn,
  signInAs,
  testCredentials,
  type Agent,
  type Credentials,
} from "./session";

const listingInput: CreateListingInput = {
  title: "Loft above the harbour",
  description: "Two rooms under the roof and a wall of glass facing the water.",
  pricePerNightCents: cents(12_000),
  capacity: 4,
};

const confirm = { password: testCredentials.password };

/** The access cookie of a session of its own, which a test keeps past an erasure. */
async function accessCookieOf(
  app: INestApplication<App>,
  credentials: Credentials,
): Promise<string> {
  const login = await request(app.getHttpServer())
    .post("/auth/login")
    .send(credentials)
    .expect(200);

  return `${ACCESS_TOKEN_COOKIE}=${readSetCookie(login, ACCESS_TOKEN_COOKIE) ?? ""}`;
}

describe("AccountController (e2e)", () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;
  let guest: Agent;
  let owner: Agent;
  let listingId: string;
  let guestId: string;
  let ownerId: string;

  const idOf = async (email: string): Promise<string> =>
    (
      await prismaService.user.findUniqueOrThrow({
        where: { email },
        select: { id: true },
      })
    ).id;

  /**
   * A stay written straight into the table, as the review spec writes one: the API books
   * nothing in the past and confirms a stay only on the provider's webhook. By default a
   * finished stay nobody paid for — the one kind with nothing left open on it.
   */
  const stay = async (
    over: {
      status?: BookingStatus;
      from?: number;
      to?: number;
      paid?: boolean;
      paidOut?: boolean;
      refundOwedCents?: number;
      disputeStatus?: DisputeStatus;
    } = {},
  ): Promise<string> => {
    const from = new Date(inDays(over.from ?? -6));
    const row = await prismaService.booking.create({
      data: {
        listingId,
        guestId,
        from,
        to: new Date(inDays(over.to ?? -2)),
        status: over.status ?? BookingStatus.CONFIRMED,
        amountCents: 48_000,
        discountCents: 0,
        currency: "usd",
        cancellationPolicy: "FLEXIBLE",
        timeZone: "UTC",
        checkInTime: "00:00",
        checkInAt: from,
        expiresAt:
          over.status === BookingStatus.PENDING_PAYMENT
            ? new Date(Date.now() + 60_000)
            : null,
        ...(over.paid === true
          ? { paidAt: new Date(), chargeId: "ch_e2e" }
          : {}),
        ...(over.paidOut === true
          ? { paidOutAt: new Date(), paidOutAmountCents: 43_200 }
          : {}),
        refundOwedCents: over.refundOwedCents ?? null,
        disputeStatus: over.disputeStatus ?? null,
      },
    });

    return row.id;
  };

  /** What a refusal for something still open names: every matter open, and on which side. */
  const paramsOf = (response: { body: unknown }): OpenMattersParams =>
    openMattersParamsSchema.parse(apiErrorSchema.parse(response.body).params);

  const openOf = (response: { body: unknown }): OpenMatter[] =>
    paramsOf(response).open;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prismaService = app.get(PrismaService);

    await resetDatabase(app);
    await resetQueue(app);

    guest = await signInAs(app, Role.USER);
    owner = await signIn(app, hostCredentials);

    const listing = await owner
      .post("/listings")
      .send(listingInput)
      .expect(201);

    listingId = (listing.body as { id: string }).id;
    guestId = await idOf(credentialsFor.USER.email);
    ownerId = await idOf(hostCredentials.email);
  });

  afterEach(async () => {
    await app.close();
  });

  describe("asking", () => {
    it("takes the password again, and refuses a wrong one without ending the session", async () => {
      await request(app.getHttpServer())
        .delete("/users/me")
        .send(confirm)
        .expect(401);

      const missing = await guest.delete("/users/me").send({}).expect(400);

      expect(issueCodesOf(missing)).toEqual(["INVALID_INPUT"]);

      const empty = await guest
        .delete("/users/me")
        .send({ password: "" })
        .expect(400);

      expect(issueCodesOf(empty)).toEqual(["PASSWORD_REQUIRED"]);

      await guest
        .delete("/users/me")
        .send({ password: "not-the-password" })
        .expect(403)
        .expect(hasCode("PASSWORD_INCORRECT"));

      // A 403, not a 401: the session it was asked from is still good.
      await guest.get("/auth/me").expect(200);
    });

    it("refuses the site's last admin and lets an admin go while another stays", async () => {
      const admin = await signInAs(app, Role.ADMIN);
      const adminConfirm = { password: credentialsFor.ADMIN.password };

      await admin
        .delete("/users/me")
        .send(adminConfirm)
        .expect(409)
        .expect(hasCode("LAST_ADMIN_CANNOT_DELETE"));

      await signInAs(app, Role.ADMIN, {
        name: "E2E Second Admin",
        email: "e2e-admin-2@example.com",
        password: "password123",
      });

      await admin.delete("/users/me").send(adminConfirm).expect(204);
    });
  });

  describe("refused while something is still open", () => {
    it("refuses a guest with a hold, however lapsed its deadline", async () => {
      await prismaService.booking.update({
        where: {
          id: await stay({
            status: BookingStatus.PENDING_PAYMENT,
            from: 3,
            to: 5,
          }),
        },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      const refused = await guest
        .delete("/users/me")
        .send(confirm)
        .expect(409)
        .expect(hasCode("ACCOUNT_HAS_OPEN_STAY"));

      expect(openOf(refused)).toEqual(["ACCOUNT_HAS_OPEN_STAY"]);
    });

    it("refuses both sides of a confirmed stay not over yet, and neither once it is", async () => {
      const bookingId = await stay({ from: -2, to: 2 });

      const asGuest = await guest
        .delete("/users/me")
        .send(confirm)
        .expect(409)
        .expect(hasCode("ACCOUNT_HAS_OPEN_STAY"));
      const asHost = await owner
        .delete("/users/me")
        .send({ password: hostCredentials.password })
        .expect(409)
        .expect(hasCode("ACCOUNT_HAS_OPEN_STAY"));

      // Each refusal says which half of the stays holds it, for the page to link to.
      expect(paramsOf(asGuest)).toEqual({
        open: ["ACCOUNT_HAS_OPEN_STAY"],
        asGuest: ["ACCOUNT_HAS_OPEN_STAY"],
        asHost: [],
      });
      expect(paramsOf(asHost)).toEqual({
        open: ["ACCOUNT_HAS_OPEN_STAY"],
        asGuest: [],
        asHost: ["ACCOUNT_HAS_OPEN_STAY"],
      });

      // The check-out day reached where the listing is: the stay is over.
      await prismaService.booking.update({
        where: { id: bookingId },
        data: { to: new Date(inDays(0)) },
      });

      await guest.delete("/users/me").send(confirm).expect(204);
      await owner
        .delete("/users/me")
        .send({ password: hostCredentials.password })
        .expect(204);
    });

    it("takes a stay ended early for one that is over, its refund still open until sent", async () => {
      // As `POST /bookings/:id/end-early` leaves it: still confirmed, the check-out moved to
      // tomorrow, the unused nights owed back.
      const bookingId = await stay({
        from: -2,
        to: 1,
        paid: true,
        refundOwedCents: 24_000,
      });

      await prismaService.booking.update({
        where: { id: bookingId },
        data: { endedEarlyAt: new Date() },
      });

      const refused = await guest
        .delete("/users/me")
        .send(confirm)
        .expect(409)
        .expect(hasCode("ACCOUNT_AWAITS_REFUND"));

      // The refund alone: a check-out of tomorrow does not make the stay open.
      expect(openOf(refused)).toEqual(["ACCOUNT_AWAITS_REFUND"]);

      await prismaService.booking.update({
        where: { id: bookingId },
        data: { refundOwedCents: null, refundedAmountCents: 24_000 },
      });

      await guest.delete("/users/me").send(confirm).expect(204);
    });

    it("refuses a cancelled stay's refund not yet sent, and one a bank sent back", async () => {
      const bookingId = await stay({
        status: BookingStatus.CANCELLED,
        from: 10,
        to: 12,
        paid: true,
        refundOwedCents: 48_000,
      });

      await guest
        .delete("/users/me")
        .send(confirm)
        .expect(409)
        .expect(hasCode("ACCOUNT_AWAITS_REFUND"));

      await prismaService.booking.update({
        where: { id: bookingId },
        data: { refundOwedCents: null, refundedAmountCents: 48_000 },
      });
      await prismaService.refundFailure.create({
        data: {
          refundId: "re_e2e_account",
          paymentId: "pi_e2e_account",
          bookingId,
          amountCents: 48_000,
          currency: "usd",
        },
      });

      await guest
        .delete("/users/me")
        .send(confirm)
        .expect(409)
        .expect(hasCode("ACCOUNT_AWAITS_REFUND"));

      await prismaService.refundFailure.update({
        where: { refundId: "re_e2e_account" },
        data: { resolvedAt: new Date(), resolution: "Sent by bank transfer" },
      });

      await guest.delete("/users/me").send(confirm).expect(204);
    });

    it("refuses an open dispute on either side", async () => {
      await stay({
        paid: true,
        disputeStatus: DisputeStatus.OPEN,
      });

      await guest
        .delete("/users/me")
        .send(confirm)
        .expect(409)
        .expect(hasCode("ACCOUNT_HAS_OPEN_DISPUTE"));
      await owner
        .delete("/users/me")
        .send({ password: hostCredentials.password })
        .expect(409)
        .expect(hasCode("ACCOUNT_HAS_OPEN_DISPUTE"));
    });

    it("refuses a host owed a share no payout can reach, and lets them go once one can", async () => {
      const bookingId = await stay({ paid: true });
      const hostConfirm = { password: hostCredentials.password };

      // No payout account at all: nothing could ever pay the share once nobody can sign in
      // to set one up. The guest has nothing left open on a finished, paid stay.
      const refused = await owner
        .delete("/users/me")
        .send(hostConfirm)
        .expect(409)
        .expect(hasCode("ACCOUNT_AWAITS_PAYOUT"));

      expect(openOf(refused)).toEqual(["ACCOUNT_AWAITS_PAYOUT"]);

      // Payouts on, but this one set aside after failing: still nothing pays it.
      await prismaService.user.update({
        where: { id: ownerId },
        data: {
          stripeAccountId: "acct_e2e_owed",
          payoutsEnabledAt: new Date(),
        },
      });
      await prismaService.booking.update({
        where: { id: bookingId },
        data: { payoutFailedAt: new Date(), payoutAttempts: 24 },
      });

      await owner
        .delete("/users/me")
        .send(hostConfirm)
        .expect(409)
        .expect(hasCode("ACCOUNT_AWAITS_PAYOUT"));

      // Handed back to the sweep, the share is no reason to stay: it is paid after.
      await prismaService.booking.update({
        where: { id: bookingId },
        data: { payoutFailedAt: null, payoutAttempts: 0 },
      });

      await owner.delete("/users/me").send(hostConfirm).expect(204);

      expect(
        await prismaService.user.findUniqueOrThrow({
          where: { id: ownerId },
          select: { stripeAccountId: true, payoutsEnabledAt: true },
        }),
      ).toEqual({
        stripeAccountId: "acct_e2e_owed",
        payoutsEnabledAt: expect.any(Date) as Date,
      });
      await expect(
        app.get(PayoutRepository).findDuePayouts(new Date(), 10),
      ).resolves.toEqual([bookingId]);
    });

    it("holds a host for the share a refund owed to their guest leaves, never for the refund", async () => {
      // A guest's cancellation under the policy: half of it owed back, half the host's.
      const bookingId = await stay({
        status: BookingStatus.CANCELLED,
        from: 10,
        to: 12,
        paid: true,
        refundOwedCents: 24_000,
      });
      const hostConfirm = { password: hostCredentials.password };

      // The refund is the guest's to wait for; the host is held only for the share left
      // after it, which nothing could pay with their payouts off.
      const asHost = await owner
        .delete("/users/me")
        .send(hostConfirm)
        .expect(409)
        .expect(hasCode("ACCOUNT_AWAITS_PAYOUT"));

      expect(paramsOf(asHost)).toEqual({
        open: ["ACCOUNT_AWAITS_PAYOUT"],
        asGuest: [],
        asHost: ["ACCOUNT_AWAITS_PAYOUT"],
      });
      expect(
        paramsOf(
          await guest
            .delete("/users/me")
            .send(confirm)
            .expect(409)
            .expect(hasCode("ACCOUNT_AWAITS_REFUND")),
        ),
      ).toEqual({
        open: ["ACCOUNT_AWAITS_REFUND"],
        asGuest: ["ACCOUNT_AWAITS_REFUND"],
        asHost: [],
      });

      // Payouts on, but this payout set aside after failing: the refund owed does not hide
      // it, since the share left after it would fall due on an account nothing pays.
      await prismaService.user.update({
        where: { id: ownerId },
        data: {
          stripeAccountId: "acct_e2e_refund",
          payoutsEnabledAt: new Date(),
        },
      });
      await prismaService.booking.update({
        where: { id: bookingId },
        data: { payoutFailedAt: new Date(), payoutAttempts: 24 },
      });

      await owner
        .delete("/users/me")
        .send(hostConfirm)
        .expect(409)
        .expect(hasCode("ACCOUNT_AWAITS_PAYOUT"));

      // Handed back to the sweep: the refund goes to the guest and the share to the
      // connected account, neither needing the host.
      await prismaService.booking.update({
        where: { id: bookingId },
        data: { payoutFailedAt: null, payoutAttempts: 0 },
      });

      await owner.delete("/users/me").send(hostConfirm).expect(204);

      expect(
        await prismaService.booking.findUniqueOrThrow({
          where: { id: bookingId },
          select: { refundOwedCents: true },
        }),
      ).toEqual({ refundOwedCents: 24_000 });
    });

    it("lets a host with no payouts go while a refund in full is owed to their guest", async () => {
      await stay({
        status: BookingStatus.CANCELLED,
        from: 10,
        to: 12,
        paid: true,
        refundOwedCents: 48_000,
      });

      // Everything goes back to the guest, so no share is left to pay the host.
      await owner
        .delete("/users/me")
        .send({ password: hostCredentials.password })
        .expect(204);
    });

    it("refuses a host who owes a cancellation fee, and lets them go once it is waived", async () => {
      const bookingId = await stay({
        status: BookingStatus.CANCELLED,
        from: 10,
        to: 12,
        paid: true,
      });
      await prismaService.booking.update({
        where: { id: bookingId },
        data: { refundedAmountCents: 48_000 },
      });
      const admin = await signInAs(app, Role.ADMIN);
      const fee = await prismaService.hostFee.create({
        data: {
          bookingId,
          hostId: ownerId,
          amountCents: 4_800,
          currency: "usd",
        },
      });
      const hostConfirm = { password: hostCredentials.password };

      await owner
        .delete("/users/me")
        .send(hostConfirm)
        .expect(409)
        .expect(hasCode("ACCOUNT_OWES_HOST_FEE"));

      await admin
        .post(`/host-fees/${fee.id}/waive`)
        .send({ reason: "The guest asked to move the dates" })
        .expect(204);

      await owner.delete("/users/me").send(hostConfirm).expect(204);
    });

    it("names every matter open at once, the first as the code", async () => {
      await stay({ status: BookingStatus.PENDING_PAYMENT, from: 3, to: 5 });
      await stay({ paid: true, disputeStatus: DisputeStatus.OPEN });
      await stay({
        status: BookingStatus.CANCELLED,
        from: 10,
        to: 12,
        paid: true,
        refundOwedCents: 10_000,
      });

      const refused = await guest
        .delete("/users/me")
        .send(confirm)
        .expect(409)
        .expect(hasCode("ACCOUNT_HAS_OPEN_STAY"));

      expect(openOf(refused)).toEqual([
        "ACCOUNT_HAS_OPEN_STAY",
        "ACCOUNT_HAS_OPEN_DISPUTE",
        "ACCOUNT_AWAITS_REFUND",
      ]);

      // Nothing was erased by a refusal.
      await guest.get("/auth/me").expect(200);
    });
  });

  describe("erasing", () => {
    it("scrubs the person and keeps the stays, the payments and the reviews", async () => {
      const bookingId = await stay({ paid: true, paidOut: true });

      await guest
        .post(`/bookings/${bookingId}/reviews`)
        .send({ rating: 5, comment: "Quiet, warm and exactly as described." })
        .expect(201);
      const thread = await guest
        .post("/conversations")
        .send({ listingId, body: "Thank you for the stay!" })
        .expect(201);
      const threadId = (thread.body as { id: string }).id;
      const ownListing = await guest
        .post("/listings")
        .send({ ...listingInput, title: "A room of the guest's own" })
        .expect(201);
      const ownListingId = (ownListing.body as { id: string }).id;
      await prismaService.waitlistEntry.create({
        data: {
          listingId,
          userId: guestId,
          from: new Date(inDays(20)),
          to: new Date(inDays(22)),
          checkInDayEndsAt: new Date(inDays(21)),
        },
      });
      await prismaService.notification.create({
        data: {
          userId: guestId,
          type: "BOOKING_CONFIRMED",
          data: {},
        },
      });

      // A second session of the same account, on another device.
      const otherDevice = request.agent(app.getHttpServer());
      await otherDevice.post("/auth/login").send(testCredentials).expect(200);

      const erased = await guest.delete("/users/me").send(confirm).expect(204);

      // The session it was asked from leaves with its cookies cleared.
      expect(readSetCookie(erased, ACCESS_TOKEN_COOKIE)).toBe("");

      // Every session is over: the asking one, and the other device's refresh.
      await guest.get("/auth/me").expect(401);
      await otherDevice.post("/auth/refresh").expect(401);

      // Gone to sign-in, and its address free again.
      await request(app.getHttpServer())
        .post("/auth/login")
        .send(testCredentials)
        .expect(401)
        .expect(hasCode("INVALID_CREDENTIALS"));

      const row = await prismaService.user.findUniqueOrThrow({
        where: { id: guestId },
      });

      expect(row).toMatchObject({
        name: DELETED_USER_NAME,
        email: placeholderEmail(guestId),
      });
      expect(row.deletedAt).not.toBeNull();

      // What was the person's alone is gone with them.
      expect(
        await prismaService.refreshToken.count({ where: { userId: guestId } }),
      ).toBe(0);
      expect(
        await prismaService.notification.count({ where: { userId: guestId } }),
      ).toBe(0);
      expect(
        await prismaService.waitlistEntry.count({ where: { userId: guestId } }),
      ).toBe(0);
      await request(app.getHttpServer())
        .get(`/listings/${ownListingId}`)
        .expect(404);

      // What the money and the other side's history rest on stays.
      const kept = bookingSchema.parse(
        (await owner.get(`/bookings/${bookingId}`).expect(200)).body,
      );

      expect(kept.status).toBe(BookingStatus.CONFIRMED);
      expect(
        await prismaService.booking.findUniqueOrThrow({
          where: { id: bookingId },
          select: { paidAt: true, paidOutAmountCents: true },
        }),
      ).toMatchObject({
        paidAt: expect.any(Date) as Date,
        paidOutAmountCents: 43_200,
      });
      expect(await prismaService.review.count({ where: { bookingId } })).toBe(
        1,
      );

      const threads = conversationPageSchema.parse(
        (await owner.get("/conversations").expect(200)).body,
      );

      expect(
        threads.items.map(({ guest, closed }) => ({
          name: guest.name,
          closed,
        })),
      ).toEqual([{ name: DELETED_USER_NAME, closed: true }]);

      // The thread stays to read and takes no new message: nobody is on the other end.
      await owner
        .post(`/conversations/${threadId}/messages`)
        .send({ body: "Come back any time." })
        .expect(409)
        .expect(hasCode("CONVERSATION_CLOSED"));
      expect(
        await prismaService.message.count({
          where: { conversationId: threadId },
        }),
      ).toBe(1);

      // And the address can open a new account, which shares nothing with the old one.
      const again = await signIn(app, testCredentials);
      const me = await again.get("/auth/me").expect(200);

      expect((me.body as { id: string }).id).not.toBe(guestId);
    });

    it("tells an erased account nothing that happens after it — a review of its stay included", async () => {
      const bookingId = await stay();

      await guest.delete("/users/me").send(confirm).expect(204);

      // The stay is still reviewable by its host: it happened, and the review is theirs.
      await owner
        .post(`/bookings/${bookingId}/reviews`)
        .send({ rating: 4, comment: "Left the place tidy, arrived late." })
        .expect(201);

      // Nobody on the other end: no notice is written to the erased account.
      expect(
        await prismaService.notification.count({ where: { userId: guestId } }),
      ).toBe(0);
    });

    it("lets nobody register the address an erasure is going to take", async () => {
      // The id is no secret — the catalogue names every listing's owner — so a registration
      // holding the placeholder first would fail the erasure on the unique key for good.
      for (const email of [
        placeholderEmail(guestId),
        placeholderEmail(guestId).toUpperCase(),
        "someone@example.invalid",
      ]) {
        const refused = await request(app.getHttpServer())
          .post("/auth/register")
          .send({ ...testCredentials, email })
          .expect(400);

        expect(issueCodesOf(refused)).toEqual(["EMAIL_INVALID"]);
      }

      await guest.delete("/users/me").send(confirm).expect(204);
    });

    it("keeps an erased host's payouts in step with what Stripe says of the account", async () => {
      await prismaService.user.update({
        where: { id: ownerId },
        data: {
          stripeAccountId: "acct_e2e_erased",
          payoutsEnabledAt: new Date(),
        },
      });

      await owner
        .delete("/users/me")
        .send({ password: hostCredentials.password })
        .expect(204);

      const payoutRepository = app.get(PayoutRepository);
      const enabled = async (): Promise<boolean> =>
        (
          await prismaService.user.findUniqueOrThrow({
            where: { id: ownerId },
            select: { payoutsEnabledAt: true },
          })
        ).payoutsEnabledAt !== null;

      // The erasure kept the account and its flag, and the account's news keeps arriving:
      // transfers off holds the shares still owed back, on again releases them.
      expect(await enabled()).toBe(true);
      await expect(
        payoutRepository.setPayoutsEnabled("acct_e2e_erased", false),
      ).resolves.toEqual({ userId: ownerId, switched: true });
      expect(await enabled()).toBe(false);
      await expect(
        payoutRepository.setPayoutsEnabled("acct_e2e_erased", true),
      ).resolves.toEqual({ userId: ownerId, switched: true });
      expect(await enabled()).toBe(true);
    });

    it("leaves an access token that outlived the erasure unable to open anything new", async () => {
      const cookie = await accessCookieOf(app, testCredentials);

      await guest.delete("/users/me").send(confirm).expect(204);

      await request(app.getHttpServer())
        .post("/bookings")
        .set("Cookie", cookie)
        .send({ listingId, from: inDays(3), to: inDays(5) })
        .expect(401)
        .expect(hasCode("SESSION_NOT_FOUND"));
      await request(app.getHttpServer())
        .post("/listings")
        .set("Cookie", cookie)
        .send(listingInput)
        .expect(401)
        .expect(hasCode("SESSION_NOT_FOUND"));
      await request(app.getHttpServer())
        .post("/conversations")
        .set("Cookie", cookie)
        .send({ listingId, body: "Is the loft free next month?" })
        .expect(401)
        .expect(hasCode("SESSION_NOT_FOUND"));
      // Refused before Stripe is asked: an erased account opens no connected account.
      await request(app.getHttpServer())
        .post("/payouts/account")
        .set("Cookie", cookie)
        .send({ country: "PL" })
        .expect(401)
        .expect(hasCode("SESSION_NOT_FOUND"));

      expect(
        await prismaService.conversation.count({ where: { guestId } }),
      ).toBe(0);
      expect(
        (
          await prismaService.user.findUniqueOrThrow({
            where: { id: guestId },
            select: { stripeAccountId: true },
          })
        ).stripeAccountId,
      ).toBeNull();
    });

    it("leaves an erased admin's access token unable to move money or block anybody", async () => {
      const admin = await signInAs(app, Role.ADMIN);
      const adminCredentials = credentialsFor.ADMIN;
      const cookie = await accessCookieOf(app, adminCredentials);

      // Somebody has to stay to run the site.
      await signInAs(app, Role.ADMIN, {
        name: "E2E Second Admin",
        email: "e2e-admin-2@example.com",
        password: "password123",
      });

      const bookingId = await stay({ paid: true });
      const fee = await prismaService.hostFee.create({
        data: {
          bookingId,
          hostId: ownerId,
          amountCents: 4_800,
          currency: "usd",
        },
      });

      await admin
        .delete("/users/me")
        .send({ password: adminCredentials.password })
        .expect(204);

      // The token still says ADMIN; the row is read again and nobody stands behind it.
      await request(app.getHttpServer())
        .post(`/host-fees/${fee.id}/waive`)
        .set("Cookie", cookie)
        .send({ reason: "The guest asked to move the dates" })
        .expect(401)
        .expect(hasCode("SESSION_NOT_FOUND"));
      await request(app.getHttpServer())
        .post(`/bookings/${bookingId}/refunds`)
        .set("Cookie", cookie)
        .send({
          amountCents: 1_000,
          reason: "A night without hot water",
          requestId: randomUUID(),
        })
        .expect(401)
        .expect(hasCode("SESSION_NOT_FOUND"));
      await request(app.getHttpServer())
        .patch(`/users/${guestId}`)
        .set("Cookie", cookie)
        .send({ blocked: true })
        .expect(403)
        .expect(hasCode("NOT_AN_ADMIN_ANYMORE"));

      expect(
        await prismaService.hostFee.findUniqueOrThrow({
          where: { id: fee.id },
          select: { waivedAt: true },
        }),
      ).toEqual({ waivedAt: null });
      expect(
        await prismaService.user.findUniqueOrThrow({
          where: { id: guestId },
          select: { blockedAt: true },
        }),
      ).toEqual({ blockedAt: null });
    });

    it("shows the admin an erased account as deleted, which nobody can block", async () => {
      const admin = await signInAs(app, Role.ADMIN);

      await guest.delete("/users/me").send(confirm).expect(204);

      const deleted = userPageSchema.parse(
        (await admin.get("/users?status=DELETED").expect(200)).body,
      );

      expect(deleted.items.map((user) => user.id)).toEqual([guestId]);
      expect(
        managedUserSchema.parse(deleted.items[0]).deletedAt,
      ).not.toBeNull();

      const active = userPageSchema.parse(
        (await admin.get("/users?status=ACTIVE").expect(200)).body,
      );

      expect(active.items.map((user) => user.id)).not.toContain(guestId);

      await admin
        .patch(`/users/${guestId}`)
        .send({ blocked: true })
        .expect(404)
        .expect(hasCode("USER_NOT_FOUND"));
    });
  });

  describe("racing a booking", () => {
    /** One guest of their own per round, so every round starts with nothing open. */
    const freshGuest = async (round: number): Promise<Agent> =>
      signIn(app, {
        name: `E2E Racer ${String(round)}`,
        email: `e2e-racer-${String(round)}@example.com`,
        password: "password123",
      } satisfies Credentials);

    it("never lets a guest's hold land on an account erased beside it", async () => {
      for (let round = 0; round < 6; round += 1) {
        const racer = await freshGuest(round);
        const [booked, erased] = await Promise.all([
          racer.post("/bookings").send({
            listingId,
            from: inDays(3 + round * 3),
            to: inDays(4 + round * 3),
          }),
          racer.delete("/users/me").send({ password: "password123" }),
        ]);

        // One of two endings, never both halves: the hold first and the erasure refused
        // for it, or the erasure first and the hold refused as an ended session.
        expect([
          [201, 409],
          [401, 204],
        ]).toContainEqual([booked.status, erased.status]);
      }
    });

    /**
     * A host of their own per round, with a listing of their own: an erased host cannot be
     * erased again, so every round needs one to race.
     */
    const freshHost = async (
      round: number,
    ): Promise<{
      host: Agent;
      hostId: string;
      listingId: string;
      hostConfirm: { password: string };
    }> => {
      const credentials = {
        name: `E2E Host ${String(round)}`,
        email: `e2e-host-${String(round)}@example.com`,
        password: "password123",
      } satisfies Credentials;
      const host = await signIn(app, credentials);
      const listing = await host
        .post("/listings")
        .send(listingInput)
        .expect(201);

      return {
        host,
        hostId: await idOf(credentials.email),
        listingId: (listing.body as { id: string }).id,
        hostConfirm: { password: credentials.password },
      };
    };

    it("never lets a thread begin about the listing of a host erased beside it", async () => {
      for (let round = 0; round < 6; round += 1) {
        const racing = await freshHost(round);
        const [started, erased] = await Promise.all([
          guest.post("/conversations").send({
            listingId: racing.listingId,
            body: "Is the loft free next month?",
          }),
          racing.host.delete("/users/me").send(racing.hostConfirm),
        ]);

        // The thread first and the host erased after it, which closes it; or the host
        // erased first and the listing retired before the thread could begin. Never a
        // `500`: the two take the host's row and the listing in the same order.
        expect([
          [201, 204],
          [404, 204],
        ]).toContainEqual([started.status, erased.status]);

        const messages = await prismaService.message.findMany({
          where: { conversation: { listingId: racing.listingId } },
          select: { createdAt: true },
        });
        const { deletedAt } = await prismaService.user.findUniqueOrThrow({
          where: { id: racing.hostId },
          select: { deletedAt: true },
        });

        // Never a thread begun after the erasure: its first message, if any, came before it.
        expect(messages).toHaveLength(started.status === 201 ? 1 : 0);
        for (const { createdAt } of messages) {
          expect(createdAt.getTime()).toBeLessThanOrEqual(
            deletedAt?.getTime() ?? 0,
          );
        }
      }
    });

    it("never deadlocks a thread held up on its listing with its host's erasure", async () => {
      /** Until this many statements of the database wait on a row lock. */
      const lockWaiters = async (count: number): Promise<void> => {
        for (let attempt = 0; attempt < 250; attempt += 1) {
          const [row] = await prismaService.$queryRaw<{ waiting: number }[]>`
            SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
          `;

          if ((row?.waiting ?? 0) >= count) return;

          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        throw new Error(
          `Never saw ${String(count)} statements waiting on a lock`,
        );
      };
      let started: Promise<request.Response> | undefined;
      let erased: Promise<request.Response> | undefined;

      // The interleaving a timing race reaches only now and then, laid out by hand: the
      // thread takes its listing's lock and is held on its guest's row, the host's erasure
      // takes the host's row and waits for the listing, and then the guest's row is let go.
      // A thread that went on to lock the host's row would close the cycle.
      await prismaService.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM users WHERE id = ${guestId}::uuid FOR UPDATE
          `;

          // `then` sends a request at once, which the test needs before it waits.
          started = guest
            .post("/conversations")
            .send({ listingId, body: "Is the loft free next month?" })
            .then((response) => response);
          await lockWaiters(1);

          erased = owner
            .delete("/users/me")
            .send({ password: hostCredentials.password })
            .then((response) => response);
          await lockWaiters(2);
        },
        { timeout: 20_000 },
      );

      if (started === undefined || erased === undefined) {
        throw new Error("The two requests were never sent");
      }

      const [thread, erasure] = await Promise.all([started, erased]);

      // The thread held the listing first, so it commits, and the erasure after it closes it.
      expect([thread.status, erasure.status]).toEqual([201, 204]);
    });

    it("refuses a member writing about their own listing as they erase, without a deadlock", async () => {
      for (let round = 0; round < 6; round += 1) {
        const racing = await freshHost(round);
        const [started, erased] = await Promise.all([
          racing.host.post("/conversations").send({
            listingId: racing.listingId,
            body: "Writing to myself",
          }),
          racing.host.delete("/users/me").send(racing.hostConfirm),
        ]);

        // Refused as one's own listing before the erasure, or after it as a listing it
        // retired — never a `500` of the two waiting on each other.
        expect([
          [403, 204],
          [404, 204],
        ]).toContainEqual([started.status, erased.status]);
      }
    });

    it("never lets a hold land on the listing of a host erased beside it", async () => {
      for (let round = 0; round < 6; round += 1) {
        const racing = await freshHost(round);
        const [booked, erased] = await Promise.all([
          guest.post("/bookings").send({
            listingId: racing.listingId,
            from: inDays(3),
            to: inDays(5),
          }),
          racing.host.delete("/users/me").send(racing.hostConfirm),
        ]);

        // The hold first and the host refused for it, or the host erased first and the
        // listing retired under the hold.
        expect([
          [201, 409],
          [404, 204],
        ]).toContainEqual([booked.status, erased.status]);

        const holds = await prismaService.booking.count({
          where: {
            listingId: racing.listingId,
            status: BookingStatus.PENDING_PAYMENT,
          },
        });
        const host = await prismaService.user.findUniqueOrThrow({
          where: { id: racing.hostId },
        });

        // Never a hold on the listing of an erased host.
        expect({ holds, erased: host.deletedAt !== null }).toEqual(
          booked.status === 201
            ? { holds: 1, erased: false }
            : { holds: 0, erased: true },
        );
      }
    });
  });
});
