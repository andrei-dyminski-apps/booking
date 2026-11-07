import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import Stripe from "stripe";
import { subDays } from "date-fns";
import {
  BASIS_POINTS,
  Role,
  hostFeeOverviewSchema,
  shareOf,
  bookingPaymentSchema,
  bookingSchema,
  userSchema,
  type Booking,
  type CreateListingInput,
} from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { useBodyParsers } from "./../src/common/body-parsers";
import type { OpenedPayment } from "./../src/payment/application/ports/payment-gateway";
import { PaymentGateway } from "./../src/payment/application/ports/payment-gateway";
import {
  addCents,
  NO_CENTS,
  type Cents,
  cents,
} from "./../src/payment/domain/money";
import { PAYMENT_CONFIG } from "./../src/payment/infrastructure/payment.config";
import { createStripeClient } from "./../src/payment/infrastructure/stripe";
import { StripePaymentGateway } from "./../src/payment/infrastructure/stripe-payment.gateway";
import { PrismaService } from "./../src/prisma/prisma.service";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { resetQueue } from "./queue";
import { waitUntil } from "./wait-until";
import { hostCredentials, signIn, signInAs, type Agent } from "./session";

/**
 * The payment cycle over HTTP, against the real database: a hold, its payment page, the
 * webhook that confirms it, and a cancellation that refunds it.
 *
 * Stripe is faked at the network and nowhere else. The gateway is the real adapter with
 * its four outgoing calls replaced, so the half that has to be real — reading a webhook
 * delivery, signature over the raw body and all — is the code that runs in production. The
 * deliveries are signed with the same secret the application was configured with, by the
 * SDK's own test helper, which is what `stripe listen` would have done.
 */
class OfflineStripeGateway extends StripePaymentGateway {
  readonly opened: string[] = [];
  readonly withdrawn: string[] = [];
  readonly refunds: { paymentId: string; amount: Cents; key: string }[] = [];

  /** How many refunds to refuse before taking one, as a provider that cannot be reached. */
  refusedRefunds = 0;

  override open(bookingId: string): Promise<OpenedPayment> {
    this.opened.push(bookingId);

    return Promise.resolve({
      id: paymentIdOf(bookingId),
      clientSecret: `${paymentIdOf(bookingId)}_secret_e2e`,
    });
  }

  override cancel(paymentId: string): Promise<void> {
    this.withdrawn.push(paymentId);

    return Promise.resolve();
  }

  override refund(
    paymentId: string,
    amount: Cents,
    key: string,
  ): Promise<Cents> {
    if (this.refusedRefunds > 0) {
      this.refusedRefunds -= 1;

      return Promise.reject(new Error("api_connection_error"));
    }

    const sent = this.refunds.find((refund) => refund.key === key);

    if (sent !== undefined) return Promise.resolve(sent.amount);

    this.refunds.push({ paymentId, amount, key });

    return Promise.resolve(amount);
  }

  override refundedSoFar(paymentId: string): Promise<Cents> {
    // One refund per key, as Stripe keeps them.
    const byKey = new Map(
      this.refunds
        .filter((refund) => refund.paymentId === paymentId)
        .map((refund) => [refund.key, refund.amount]),
    );

    return Promise.resolve(
      [...byKey.values()].reduce(
        (total, amount) => addCents(total, amount),
        NO_CENTS,
      ),
    );
  }
}

/** One PaymentIntent per booking, as the idempotency key makes it in Stripe. */
const paymentIdOf = (bookingId: string): string =>
  `pi_${bookingId.replaceAll("-", "")}`;

/** And the one charge it produces. */
const chargeIdOf = (bookingId: string): string =>
  `ch_${bookingId.replaceAll("-", "")}`;

const listingInput: CreateListingInput = {
  title: "Loft above the harbour",
  description: "Two rooms under the roof and a wall of glass facing the water.",
  pricePerNightCents: cents(12_035),
  capacity: 4,
};

describe("Payments (e2e)", () => {
  let app: NestExpressApplication;
  let gateway: OfflineStripeGateway;
  let guest: Agent;
  let owner: Agent;
  let admin: Agent;
  let listingId: string;

  const paymentWebhookSecret = "whsec_e2e";
  const signer = new Stripe("sk_test_e2e");

  beforeEach(async () => {
    const config = {
      secretKey: "sk_test_e2e",
      paymentWebhookSecret,
      payoutWebhookSecret: paymentWebhookSecret,
      site: "e2e",
    };
    gateway = new OfflineStripeGateway(config, createStripeClient(config));

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PAYMENT_CONFIG)
      .useValue(config)
      .overrideProvider(PaymentGateway)
      .useValue(gateway)
      .compile();

    // What main.ts does, and what the webhook cannot work without.
    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    useBodyParsers(app);
    await app.init();

    await resetDatabase(app);
    await resetQueue(app);

    guest = await signInAs(app, Role.USER);
    owner = await signIn(app, hostCredentials);
    admin = await signInAs(app, Role.ADMIN);

    listingId = (
      (await owner.post("/listings").send(listingInput).expect(201)).body as {
        id: string;
      }
    ).id;
  });

  afterEach(async () => {
    await app.close();
  });

  const hold = async (from = 10, to = 13): Promise<Booking> =>
    bookingSchema.parse(
      (
        await guest
          .post("/bookings")
          .send({ listingId, from: inDays(from), to: inDays(to) })
          .expect(201)
      ).body,
    );

  const read = async (id: string): Promise<Booking> =>
    bookingSchema.parse((await guest.get(`/bookings/${id}`).expect(200)).body);

  /** A cancellation's refund is sent by the queue's worker, after the request answered. */
  const refundSent = (id: string): Promise<void> =>
    waitUntil(async () => (await read(id)).refundOwedCents === null);

  /**
   * The webhook answers once it has recorded the event and a worker handles it afterwards;
   * this waits for the inbox to drain, so what a spec reads next is the outcome.
   */
  const settled = async (delivery: PromiseLike<unknown>): Promise<void> => {
    await delivery;
    await waitUntil(
      async () =>
        (await app
          .get(PrismaService)
          .paymentEvent.count({ where: { processedAt: null } })) === 0,
    );
  };

  /** One delivery to `path`, signed the way Stripe signs one unless a spec forges it. */
  const post = (path: string, body: object, signature?: string) => {
    const payload = JSON.stringify(body);

    return request(app.getHttpServer())
      .post(path)
      .set("content-type", "application/json")
      .set(
        "stripe-signature",
        signature ??
          signer.webhooks.generateTestHeaderString({
            payload,
            secret: paymentWebhookSecret,
          }),
      )
      .send(payload);
  };

  /** A delivery of `payment_intent.succeeded`. */
  const deliver = (
    booking: Booking,
    {
      eventId = `evt_${booking.id}`,
      signature,
      metadata = { bookingId: booking.id, site: "e2e" },
    }: {
      eventId?: string;
      signature?: string;
      metadata?: Record<string, string>;
    } = {},
  ) =>
    post(
      "/payments/webhook",
      {
        id: eventId,
        object: "event",
        type: "payment_intent.succeeded",
        data: {
          object: {
            id: paymentIdOf(booking.id),
            object: "payment_intent",
            amount_received: booking.amountCents,
            latest_charge: chargeIdOf(booking.id),
            metadata,
          },
        },
      },
      signature,
    );

  /** A delivery about the charge of a stay: a refund or a dispute. */
  const deliverChargeEvent = (
    booking: Booking,
    type: string,
    object: object,
    eventId = `evt_${type}_${booking.id}`,
  ) =>
    post("/payments/webhook", {
      id: eventId,
      object: "event",
      type,
      data: {
        object: {
          payment_intent: paymentIdOf(booking.id),
          ...object,
        },
      },
    });

  /** A paid stay, `from` days ahead. */
  const paid = async (from = 10, to = 13): Promise<Booking> => {
    const booking = await hold(from, to);
    await guest.post(`/bookings/${booking.id}/payment`).expect(200);
    await settled(deliver(booking).expect(200));

    return booking;
  };

  it("quotes the stay on the server and opens one payment for it", async () => {
    const booking = await hold();

    // Three nights at 12_035 cents.
    expect(booking.amountCents).toBe(36_105);

    const first = bookingPaymentSchema.parse(
      (await guest.post(`/bookings/${booking.id}/payment`).expect(200)).body,
    );
    await guest.post(`/bookings/${booking.id}/payment`).expect(200);

    expect(first).toEqual({
      clientSecret: `${paymentIdOf(booking.id)}_secret_e2e`,
      amountCents: 36_105,
      currency: "usd",
    });
    // The host may read the stay; paying for it is the guest's alone.
    await owner.post(`/bookings/${booking.id}/payment`).expect(403);
  });

  it("refuses a stay cheaper than one payment can carry, and holds no nights for it", async () => {
    const cheap = (
      (
        await owner
          .post("/listings")
          .send({ ...listingInput, pricePerNightCents: 30 })
          .expect(201)
      ).body as { id: string }
    ).id;

    await guest
      .post("/bookings")
      .send({ listingId: cheap, from: inDays(10), to: inDays(11) })
      .expect(422);
    await guest
      .post("/bookings")
      .send({ listingId: cheap, from: inDays(10), to: inDays(12) })
      .expect(201);
  });

  it("confirms the stay on a signed delivery, and once however often it comes", async () => {
    const booking = await hold();
    await guest.post(`/bookings/${booking.id}/payment`).expect(200);

    await settled(deliver(booking).expect(200));
    await settled(deliver(booking).expect(200));

    expect((await read(booking.id)).status).toBe("CONFIRMED");
    expect(
      await app.get(PrismaService).paymentEvent.count({
        where: { id: `evt_${booking.id}` },
      }),
    ).toBe(1);
    // A paid stay has nothing left to pay.
    await guest.post(`/bookings/${booking.id}/payment`).expect(409);
  });

  it("refuses a delivery that is not signed by the provider, and changes nothing", async () => {
    const booking = await hold();

    await settled(deliver(booking, { signature: "t=1,v1=forged" }).expect(400));

    expect((await read(booking.id)).status).toBe("PENDING_PAYMENT");
  });

  it("refunds a payment that lands on a cancelled hold", async () => {
    const booking = await hold();
    await guest.post(`/bookings/${booking.id}/payment`).expect(200);
    await guest.delete(`/bookings/${booking.id}`).expect(204);

    // Withdrawn by the queue's worker, after the request has answered.
    await waitUntil(() => Promise.resolve(gateway.withdrawn.length > 0));
    expect(gateway.withdrawn).toEqual([paymentIdOf(booking.id)]);

    await settled(deliver(booking).expect(200));

    const after = await read(booking.id);
    expect(after.status).toBe("CANCELLED");
    expect(after.refundedAmountCents).toBe(36_105);
    expect(gateway.refunds).toEqual([
      expect.objectContaining({
        paymentId: paymentIdOf(booking.id),
        amount: 36_105,
      }),
    ]);
  });

  it("answers a delivery before its work, and finishes the work once Stripe answers", async () => {
    const booking = await hold();
    await guest.post(`/bookings/${booking.id}/payment`).expect(200);
    await guest.delete(`/bookings/${booking.id}`).expect(204);
    gateway.refusedRefunds = 1;

    // The refund of this late payment fails, and Stripe is still answered `200`.
    await deliver(booking).expect(200);

    const prismaService = app.get(PrismaService);
    expect(
      await prismaService.paymentEvent.findUniqueOrThrow({
        where: { id: `evt_${booking.id}` },
      }),
    ).toMatchObject({ type: "payment_intent.succeeded" });

    // The worker's next attempt, five seconds on, sends it.
    await waitUntil(
      async () => (await read(booking.id)).refundedAmountCents !== null,
    );
    expect(gateway.refunds).toHaveLength(1);
    await waitUntil(
      async () =>
        (
          await prismaService.paymentEvent.findUniqueOrThrow({
            where: { id: `evt_${booking.id}` },
          })
        ).processedAt !== null,
    );
  }, 20_000);

  it("leaves alone a payment another site or nobody opened", async () => {
    const booking = await hold();
    await guest.post(`/bookings/${booking.id}/payment`).expect(200);
    await guest.delete(`/bookings/${booking.id}`).expect(204);

    // The same account's other deployment, and a payment made by hand with a stray id.
    await settled(
      deliver(booking, {
        eventId: "evt_elsewhere",
        metadata: { bookingId: booking.id, site: "elsewhere" },
      }).expect(200),
    );
    await settled(
      deliver(booking, {
        eventId: "evt_by_hand",
        metadata: { bookingId: "x", site: "e2e" },
      }).expect(200),
    );

    expect(gateway.refunds).toEqual([]);
    expect((await read(booking.id)).refundedAmountCents).toBeNull();
  });

  it("refunds a paid stay cancelled inside the free window", async () => {
    const booking = await hold(30, 33);
    await guest.post(`/bookings/${booking.id}/payment`).expect(200);
    await settled(deliver(booking).expect(200));

    await guest.delete(`/bookings/${booking.id}`).expect(204);
    await refundSent(booking.id);

    const after = await read(booking.id);
    expect(after.status).toBe("CANCELLED");
    expect(after.refundedAmountCents).toBe(booking.amountCents);
    expect(gateway.refunds).toEqual([
      {
        paymentId: paymentIdOf(booking.id),
        amount: booking.amountCents,
        key: `booking-${booking.id}-cancellation`,
      },
    ]);
  });

  it("refunds the share of the window a cancellation falls in, and in full within the grace period", async () => {
    // LIMITED: full until 14 days before check-in, half until 7.
    await owner
      .patch(`/listings/${listingId}`)
      .send({ cancellationPolicy: "LIMITED" })
      .expect(200);

    const half = await hold(10, 13);
    await guest.post(`/bookings/${half.id}/payment`).expect(200);
    await settled(deliver(half).expect(200));
    // Booked two days ago, so the grace period is over.
    await app.get(PrismaService).booking.update({
      where: { id: half.id },
      data: { createdAt: subDays(new Date(), 2) },
    });

    await guest.delete(`/bookings/${half.id}`).expect(204);
    await refundSent(half.id);

    expect(half.cancellationPolicy).toBe("LIMITED");
    expect((await read(half.id)).refundedAmountCents).toBe(
      shareOf(half.amountCents, BASIS_POINTS / 2),
    );

    // The same nights, freed by that cancellation and booked a moment ago: still inside
    // the 50% window by the tiers, but check-in is more than 7 days away, so in full.
    const graced = await hold(10, 13);
    await guest.post(`/bookings/${graced.id}/payment`).expect(200);
    await settled(deliver(graced).expect(200));

    await guest.delete(`/bookings/${graced.id}`).expect(204);
    await refundSent(graced.id);

    expect((await read(graced.id)).refundedAmountCents).toBe(
      graced.amountCents,
    );
  });

  it("refunds nothing to a guest cancelling the day before, and all on an admin's word", async () => {
    const late = await hold(1, 3);
    await guest.post(`/bookings/${late.id}/payment`).expect(200);
    await settled(deliver(late).expect(200));

    await guest.delete(`/bookings/${late.id}`).expect(204);
    expect((await read(late.id)).refundedAmountCents).toBeNull();

    const taken = await hold(1, 3);
    await guest.post(`/bookings/${taken.id}/payment`).expect(200);
    await settled(deliver(taken).expect(200));

    await admin.delete(`/bookings/${taken.id}`).expect(204);
    await refundSent(taken.id);
    expect((await read(taken.id)).refundedAmountCents).toBe(taken.amountCents);
  });

  it("refunds the guest in full when the host cancels, whatever the policy, and charges the host's fee", async () => {
    await owner
      .patch(`/listings/${listingId}`)
      .send({ cancellationPolicy: "NON_REFUNDABLE" })
      .expect(200);

    // The day before check-in: nothing for a guest under any policy, half the stay for a host.
    const taken = await paid(1, 3);

    await owner
      .delete(`/bookings/${taken.id}`)
      .send({ reason: "A pipe burst in the bathroom" })
      .expect(204);
    await refundSent(taken.id);

    expect((await read(taken.id)).refundedAmountCents).toBe(taken.amountCents);

    const mine = hostFeeOverviewSchema.parse(
      (await owner.get("/host-fees/mine").expect(200)).body,
    );
    const fee = shareOf(taken.amountCents, BASIS_POINTS / 2);

    expect(mine).toMatchObject({
      cancellationsInWindow: 1,
      owedCents: fee,
      fees: [
        {
          bookingId: taken.id,
          amountCents: fee,
          withheldCents: 0,
          cancellationReason: "A pipe burst in the bathroom",
        },
      ],
    });

    // The host's own fee is the admin's to waive, not theirs.
    const feeId = mine.fees[0]?.id ?? "";

    await owner
      .post(`/host-fees/${feeId}/waive`)
      .send({ reason: "Mine" })
      .expect(403);
    await admin
      .post(`/host-fees/${feeId}/waive`)
      .send({ reason: "A flood the policy could not foresee" })
      .expect(204);
    await admin
      .post(`/host-fees/${feeId}/waive`)
      .send({ reason: "Again" })
      .expect(409);

    const hostId = (await read(taken.id)).hostId;
    const seen = hostFeeOverviewSchema.parse(
      (await admin.get(`/host-fees?hostId=${hostId}`).expect(200)).body,
    );

    const me = userSchema.parse((await admin.get("/auth/me").expect(200)).body);

    expect(seen.owedCents).toBe(0);
    expect(seen.fees[0]).toMatchObject({
      waiveReason: "A flood the policy could not foresee",
      waivedBy: { id: me.id, name: me.name },
    });

    // The host is told why, not which admin.
    const theirs = hostFeeOverviewSchema.parse(
      (await owner.get("/host-fees/mine").expect(200)).body,
    );

    expect(theirs.fees[0]).toMatchObject({
      waiveReason: "A flood the policy could not foresee",
      waivedBy: null,
    });

    // A demotion written in the database leaves the token claiming ADMIN until its next
    // refresh; the waiver reads the row, so the token is refused — before the fee is read.
    await app
      .get(PrismaService)
      .user.update({ where: { id: me.id }, data: { role: Role.USER } });
    await admin
      .post(`/host-fees/${feeId}/waive`)
      .send({ reason: "After the demotion" })
      .expect(403);
  });

  it("records the charge a payment produced, for the host's transfer", async () => {
    const booking = await paid();

    const row = await app
      .get(PrismaService)
      .booking.findUniqueOrThrow({ where: { id: booking.id } });

    expect(row.chargeId).toBe(chargeIdOf(booking.id));
  });

  it("cancels a stay refunded in full from Stripe's dashboard", async () => {
    const booking = await paid();

    await settled(
      deliverChargeEvent(booking, "charge.refunded", {
        id: chargeIdOf(booking.id),
        object: "charge",
        amount_refunded: booking.amountCents,
      }).expect(200),
    );

    const after = await read(booking.id);
    expect(after.status).toBe("CANCELLED");
    expect(after.refundedAmountCents).toBe(booking.amountCents);
    // The dashboard did the refunding; the API sends none of its own.
    expect(gateway.refunds).toEqual([]);
  });

  it("only records a refund this API sent itself", async () => {
    const booking = await paid(30, 33);
    await guest.delete(`/bookings/${booking.id}`).expect(204);
    await refundSent(booking.id);

    await settled(
      deliverChargeEvent(booking, "charge.refunded", {
        id: chargeIdOf(booking.id),
        object: "charge",
        amount_refunded: booking.amountCents,
      }).expect(200),
    );

    const after = await read(booking.id);
    expect(after.status).toBe("CANCELLED");
    expect(after.refundedAmountCents).toBe(booking.amountCents);
  });

  it("marks a disputed stay and tells its host", async () => {
    const booking = await paid();

    await settled(
      deliverChargeEvent(booking, "charge.dispute.created", {
        id: "dp_e2e",
        object: "dispute",
        status: "needs_response",
      }).expect(200),
    );

    const prismaService = app.get(PrismaService);
    const row = await prismaService.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });

    expect(row.disputeStatus).toBe("OPEN");
    expect(
      await prismaService.notification.count({
        where: { type: "PAYMENT_DISPUTED" },
      }),
    ).toBe(1);
  });

  it("takes a signed account event and refuses a forged one", async () => {
    const event = {
      id: "evt_account_e2e",
      object: "v2.core.event",
      type: "v2.core.account.updated",
      created: new Date().toISOString(),
      livemode: false,
      related_object: {
        id: "acct_e2e",
        type: "v2.core.account",
        url: "/v2/core/accounts/acct_e2e",
      },
    };

    await settled(post("/payouts/webhook", event, "t=1,v1=forged").expect(400));
    await settled(post("/payouts/webhook", event).expect(200));

    expect(
      await app
        .get(PrismaService)
        .paymentEvent.count({ where: { id: "evt_account_e2e" } }),
    ).toBe(1);
  });
});
