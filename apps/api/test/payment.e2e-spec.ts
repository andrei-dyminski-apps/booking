import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import Stripe from "stripe";
import { subDays } from "date-fns";
import {
  BASIS_POINTS,
  Role,
  STAY_TOO_CHEAP,
  apiErrorSchema,
  bookingAdjustmentListSchema,
  bookingAdjustmentSchema,
  hostFeeOverviewSchema,
  hostShare,
  notificationPageSchema,
  shareOf,
  bookingDetailSchema,
  bookingPaymentSchema,
  bookingSchema,
  stayTotal,
  userSchema,
  type Booking,
  type CreateListingInput,
} from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { useBodyParsers } from "./../src/common/body-parsers";
import type {
  OpenedPayment,
  PaymentRefunds,
  SentRefund,
} from "./../src/payment/application/ports/payment-gateway";
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
import { PayoutGateway } from "./../src/payout/application/ports/payout-gateway";
import { StripePayoutGateway } from "./../src/payout/infrastructure/stripe-payout.gateway";
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

  override async refundNow(
    paymentId: string,
    amount: Cents,
    key: string,
  ): Promise<SentRefund> {
    return {
      id: `re_${key}`,
      amount: await this.refund(paymentId, amount, key),
    };
  }

  override async findRefunds(
    paymentId: string,
    key: string,
  ): Promise<PaymentRefunds> {
    const sent = this.refunds.find(
      (refund) => refund.key === key && refund.paymentId === paymentId,
    );

    return {
      refunded: await this.refundedSoFar(paymentId),
      sent:
        sent === undefined ? null : { id: `re_${key}`, amount: sent.amount },
    };
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

/**
 * The host's half, with only what a settlement sends replaced: what a transfer still holds
 * and the reversals taken out of it. The account event's signature check stays the real one.
 */
class OfflinePayoutGateway extends StripePayoutGateway {
  readonly sent = new Map<string, Cents>();
  readonly reversals: { transferId: string; amount: Cents }[] = [];

  override heldOnTransfer(transferId: string): Promise<Cents> {
    const reversed = this.reversals
      .filter((reversal) => reversal.transferId === transferId)
      .reduce((total, reversal) => addCents(total, reversal.amount), NO_CENTS);

    return Promise.resolve(
      cents((this.sent.get(transferId) ?? NO_CENTS) - reversed),
    );
  }

  override reverseTransfer(transferId: string, amount: Cents): Promise<void> {
    this.reversals.push({ transferId, amount });

    return Promise.resolve();
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
  let payoutGateway: OfflinePayoutGateway;
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
    payoutGateway = new OfflinePayoutGateway(
      config,
      createStripeClient(config),
    );

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PAYMENT_CONFIG)
      .useValue(config)
      .overrideProvider(PaymentGateway)
      .useValue(gateway)
      .overrideProvider(PayoutGateway)
      .useValue(payoutGateway)
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

    const refused = await guest
      .post("/bookings")
      .send({ listingId: cheap, from: inDays(10), to: inDays(11) })
      .expect(422);
    // The words of `chargeRefusal`, which the booking form shows before the press.
    expect(apiErrorSchema.parse(refused.body).message).toBe(STAY_TOO_CHEAP);
    await guest
      .post("/bookings")
      .send({ listingId: cheap, from: inDays(10), to: inDays(12) })
      .expect(201);
  });

  it("bounds a non-refundable stay after its discount, and stores the odd cent of the deepest one", async () => {
    const publish = async (
      pricePerNightCents: number,
      nonRefundableDiscountBps: number,
    ): Promise<string> =>
      (
        (
          await owner
            .post("/listings")
            .send({
              ...listingInput,
              pricePerNightCents,
              nonRefundableDiscountBps,
            })
            .expect(201)
        ).body as { id: string }
      ).id;
    const book = (listingId: string, from: number, rate?: string) =>
      guest
        .post("/bookings")
        .send({ listingId, from: inDays(from), to: inDays(from + 1), rate });

    // 50 cents is the floor itself; 1% off it rounds up to a cent and leaves 49.
    const atTheFloor = await publish(50, 100);
    const refused = await book(atTheFloor, 10, "NON_REFUNDABLE").expect(422);
    expect(apiErrorSchema.parse(refused.body).message).toBe(STAY_TOO_CHEAP);
    await book(atTheFloor, 10).expect(201);

    // Half of 12_001 is 6_000.5, and the guest is given the odd cent: a discount one past
    // what is charged, which the column's CHECK has to take.
    const odd = await publish(12_001, 5_000);
    const booking = bookingSchema.parse(
      (await book(odd, 10, "NON_REFUNDABLE").expect(201)).body,
    );
    const detail = bookingDetailSchema.parse(
      (await guest.get(`/bookings/${booking.id}`).expect(200)).body,
    );

    expect(booking.amountCents).toBe(6_000);
    expect(detail.discountCents).toBe(6_001);
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

  it("takes the non-refundable rate's discount off the stay, refunds its guest nothing and its host's or an admin's cancellation in full", async () => {
    await owner
      .patch(`/listings/${listingId}`)
      .send({ nonRefundableDiscountBps: 1_000 })
      .expect(200);

    const nonRefundable = async (
      from: number,
      to: number,
    ): Promise<Booking> => {
      const booking = bookingSchema.parse(
        (
          await guest
            .post("/bookings")
            .send({
              listingId,
              from: inDays(from),
              to: inDays(to),
              rate: "NON_REFUNDABLE",
            })
            .expect(201)
        ).body,
      );
      await guest.post(`/bookings/${booking.id}/payment`).expect(200);
      await settled(deliver(booking).expect(200));

      return booking;
    };

    // A month ahead and booked a moment ago: a FLEXIBLE stay would refund in full, and the
    // grace period would too — neither applies to the rate.
    const kept = await nonRefundable(30, 33);
    const detail = bookingDetailSchema.parse(
      (await guest.get(`/bookings/${kept.id}`).expect(200)).body,
    );

    // Three nights at 12_035 cents, 10% off the 36_105 once: 3_610.5 rounds up to 3_611.
    expect(kept.cancellationPolicy).toBe("NON_REFUNDABLE");
    expect(detail.discountCents).toBe(3_611);
    expect(stayTotal(detail.nights)).toBe(36_105);
    expect(kept.amountCents).toBe(32_494);

    await guest.delete(`/bookings/${kept.id}`).expect(204);

    const cancelled = await read(kept.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.refundedAmountCents).toBeNull();
    expect(cancelled.refundOwedCents).toBeNull();

    const byHost = await nonRefundable(40, 43);
    await owner
      .delete(`/bookings/${byHost.id}`)
      .send({ reason: "The roof is being replaced" })
      .expect(204);
    await refundSent(byHost.id);
    expect((await read(byHost.id)).refundedAmountCents).toBe(32_494);

    const byAdmin = await nonRefundable(50, 53);
    await admin.delete(`/bookings/${byAdmin.id}`).expect(204);
    await refundSent(byAdmin.id);
    expect((await read(byAdmin.id)).refundedAmountCents).toBe(32_494);

    expect(gateway.refunds.map(({ paymentId }) => paymentId)).toEqual([
      paymentIdOf(byHost.id),
      paymentIdOf(byAdmin.id),
    ]);

    // A listing that withdrew the rate refuses it, and the standard rate is charged in full.
    await owner
      .patch(`/listings/${listingId}`)
      .send({ nonRefundableDiscountBps: null })
      .expect(200);
    await guest
      .post("/bookings")
      .send({
        listingId,
        from: inDays(60),
        to: inDays(63),
        rate: "NON_REFUNDABLE",
      })
      .expect(400);

    const standard = await hold(60, 63);
    expect(standard.amountCents).toBe(36_105);
    expect(standard.cancellationPolicy).toBe("FLEXIBLE");
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

  /** The refund total a `charge.refunded` delivery reports for the stay's charge. */
  const deliverRefunded = (booking: Booking, total: number, eventId: string) =>
    settled(
      deliverChargeEvent(
        booking,
        "charge.refunded",
        {
          id: chargeIdOf(booking.id),
          object: "charge",
          amount_refunded: total,
        },
        eventId,
      ).expect(200),
    );

  it("refunds part of a stay on an admin's word, once per press, and never past what is left", async () => {
    const booking = await paid(30, 33);
    const requestId = randomUUID();
    const body = {
      amountCents: 5_000,
      reason: "The hot water was off for two nights",
      requestId,
    };

    await guest.post(`/bookings/${booking.id}/refunds`).send(body).expect(403);
    await owner.post(`/bookings/${booking.id}/refunds`).send(body).expect(403);
    await admin
      .post(`/bookings/${booking.id}/refunds`)
      .send({ ...body, reason: " " })
      .expect(400);

    const first = bookingAdjustmentSchema.parse(
      (
        await admin
          .post(`/bookings/${booking.id}/refunds`)
          .send(body)
          .expect(200)
      ).body,
    );
    const key = `booking-${booking.id}-adjustment-${requestId}`;

    expect(first).toMatchObject({
      bookingId: booking.id,
      amountCents: 5_000,
      reason: body.reason,
      refundId: `re_${key}`,
    });

    // A second press is the same refund: answered with the same row, nothing sent again.
    const again = bookingAdjustmentSchema.parse(
      (
        await admin
          .post(`/bookings/${booking.id}/refunds`)
          .send(body)
          .expect(200)
      ).body,
    );

    expect(again.id).toBe(first.id);
    expect(gateway.refunds).toEqual([
      { paymentId: paymentIdOf(booking.id), amount: 5_000, key },
    ]);

    // Before its webhook the stay's record has nothing refunded, but Stripe has: the rest of
    // the stay would refund it in full and cancel it, so it is refused before it is sent.
    await admin
      .post(`/bookings/${booking.id}/refunds`)
      .send({
        ...body,
        amountCents: booking.amountCents - 5_000,
        requestId: randomUUID(),
      })
      .expect(409);
    expect(gateway.refunds).toHaveLength(1);

    // The total is the provider's news to raise, and the stay stays as it is.
    await deliverRefunded(booking, 5_000, `evt_refunded_${requestId}`);

    const after = await read(booking.id);

    expect(after.status).toBe("CONFIRMED");
    expect(after.refundedAmountCents).toBe(5_000);

    // All that is left would cancel a stay not yet begun, so its last cent stays: refused
    // before anything is sent.
    await admin
      .post(`/bookings/${booking.id}/refunds`)
      .send({
        ...body,
        amountCents: booking.amountCents - 5_000,
        requestId: randomUUID(),
      })
      .expect(409);
    expect(gateway.refunds).toHaveLength(1);

    const listed = bookingAdjustmentListSchema.parse(
      (await admin.get(`/bookings/${booking.id}/refunds`).expect(200)).body,
    );
    const me = userSchema.parse((await admin.get("/auth/me").expect(200)).body);

    expect(listed).toEqual([{ ...first, admin: { id: me.id, name: me.name } }]);

    // The bank sent it back: the list says so, read off the bounced refunds by its id.
    await app.get(PrismaService).refundFailure.create({
      data: {
        refundId: `re_${key}`,
        paymentId: paymentIdOf(booking.id),
        bookingId: booking.id,
        amountCents: 5_000,
        currency: booking.currency,
      },
    });

    expect(
      bookingAdjustmentListSchema.parse(
        (await admin.get(`/bookings/${booking.id}/refunds`).expect(200)).body,
      ),
    ).toMatchObject([{ id: first.id, bounce: "OPEN" }]);
    await guest.get(`/bookings/${booking.id}/refunds`).expect(403);
  });

  it("leaves no room for an admin's refund beside what a cancellation still owes", async () => {
    const booking = await paid(30, 33);

    // A debt the job has not sent yet: the whole stay is spoken for.
    await app.get(PrismaService).booking.update({
      where: { id: booking.id },
      data: { refundOwedCents: booking.amountCents },
    });

    await admin
      .post(`/bookings/${booking.id}/refunds`)
      .send({ amountCents: 100, reason: "Goodwill", requestId: randomUUID() })
      .expect(409);
    expect(gateway.refunds).toEqual([]);
  });

  it("refuses an admin's refund while the payment is disputed, and of a stay nobody paid for", async () => {
    const booking = await paid();
    const body = { amountCents: 1_000, reason: "Goodwill" };

    await settled(
      deliverChargeEvent(booking, "charge.dispute.created", {
        id: "dp_e2e",
        object: "dispute",
        status: "needs_response",
      }).expect(200),
    );

    await admin
      .post(`/bookings/${booking.id}/refunds`)
      .send({ ...body, requestId: randomUUID() })
      .expect(409);

    const unpaid = await hold(20, 22);

    await admin
      .post(`/bookings/${unpaid.id}/refunds`)
      .send({ ...body, requestId: randomUUID() })
      .expect(409);
    expect(gateway.refunds).toEqual([]);
  });

  it("takes an admin's refund after the payout back from the host's transfer", async () => {
    const booking = await paid();
    const transferId = `tr_${booking.id.replaceAll("-", "")}`;
    const paidOut = hostShare(booking.amountCents, NO_CENTS);

    payoutGateway.sent.set(transferId, paidOut);
    await app.get(PrismaService).booking.update({
      where: { id: booking.id },
      data: {
        transferId,
        paidOutAmountCents: paidOut,
        paidOutAt: new Date(),
      },
    });

    const requestId = randomUUID();

    await admin
      .post(`/bookings/${booking.id}/refunds`)
      .send({ amountCents: 6_000, reason: "The heating failed", requestId })
      .expect(200);
    await deliverRefunded(booking, 6_000, `evt_refunded_${requestId}`);

    const owed = hostShare(booking.amountCents, cents(6_000));

    expect(payoutGateway.reversals).toEqual([
      { transferId, amount: paidOut - owed },
    ]);

    const row = await app
      .get(PrismaService)
      .booking.findUniqueOrThrow({ where: { id: booking.id } });

    expect(row.paidOutAmountCents).toBe(owed);
  });

  /**
   * A paid stay of three nights that began today: booked ten days ahead — `POST /bookings`
   * refuses a check-in in the past — and moved back, its nights with it.
   */
  const begun = async (): Promise<Booking> => {
    const booking = await paid(10, 13);
    const prisma = app.get(PrismaService);

    await prisma.$executeRaw`
      UPDATE bookings SET from_date = from_date - 10, to_date = to_date - 10
      WHERE id = ${booking.id}::uuid
    `;
    await prisma.$executeRaw`
      UPDATE booking_nights SET date = date - 10 WHERE booking_id = ${booking.id}::uuid
    `;

    return read(booking.id);
  };

  it("ends a stay early: the nights after tonight come free, their refund goes out and the review opens", async () => {
    const booking = await begun();
    const unused = cents(2 * listingInput.pricePerNightCents);

    // Confirmed for more than the unused nights give back, it is refused and ends nothing.
    await guest
      .post(`/bookings/${booking.id}/end-early`)
      .send({ checkOut: inDays(1), refundCents: unused + 1 })
      .expect(409);
    await guest
      .post(`/bookings/${booking.id}/end-early`)
      .send({ checkOut: inDays(1), refundCents: unused })
      .expect(204);
    await refundSent(booking.id);

    const after = await read(booking.id);

    expect(after).toMatchObject({
      status: "CONFIRMED",
      from: inDays(0),
      to: inDays(1),
      refundedAmountCents: unused,
      refundOwedCents: null,
    });
    expect(after.endedEarlyAt).not.toBeNull();
    expect(gateway.refunds).toEqual([
      {
        paymentId: paymentIdOf(booking.id),
        amount: unused,
        key: `booking-${booking.id}-cancellation`,
      },
    ]);

    // The host hears of it; the guest, who ended it, does not.
    const told = notificationPageSchema
      .parse((await owner.get("/notifications").expect(200)).body)
      .items.filter(({ type }) => type === "STAY_ENDED_EARLY");

    expect(told.map(({ data }) => data)).toEqual([
      expect.objectContaining({
        bookingId: booking.id,
        recipient: "HOST",
        endedBy: "GUEST",
        checkOut: inDays(1),
        to: inDays(3),
        refundCents: unused,
      }),
    ]);
    expect(
      notificationPageSchema
        .parse((await guest.get("/notifications").expect(200)).body)
        .items.some(({ type }) => type === "STAY_ENDED_EARLY"),
    ).toBe(false);

    // What was bought stays on record.
    const detail = (await guest.get(`/bookings/${booking.id}`).expect(200))
      .body as { nights: unknown[] };

    expect(detail.nights).toHaveLength(3);

    // The nights from tomorrow on are anybody's again.
    await guest
      .post("/bookings")
      .send({ listingId, from: inDays(1), to: inDays(3) })
      .expect(201);

    await guest
      .post(`/bookings/${booking.id}/reviews`)
      .send({ rating: 5, comment: "Had to leave early, but a lovely place." })
      .expect(201);
  });

  it("refuses the host, a stay not begun and a second press, and refunds nothing under a policy that keeps the nights", async () => {
    const booking = await begun();

    await owner
      .post(`/bookings/${booking.id}/end-early`)
      .send({ checkOut: inDays(1), refundCents: 0 })
      .expect(403);

    const ahead = await paid(20, 23);

    await guest
      .post(`/bookings/${ahead.id}/end-early`)
      .send({ checkOut: inDays(1), refundCents: 0 })
      .expect(409);

    await app.get(PrismaService).booking.update({
      where: { id: booking.id },
      data: { cancellationPolicy: "FIRM" },
    });
    // Without the check-out it was stated for, and with one the day has left behind.
    await admin.post(`/bookings/${booking.id}/end-early`).expect(400);
    await admin
      .post(`/bookings/${booking.id}/end-early`)
      .send({ checkOut: inDays(0), refundCents: 0 })
      .expect(409);
    await admin
      .post(`/bookings/${booking.id}/end-early`)
      .send({ checkOut: inDays(1), refundCents: 0 })
      .expect(204);
    await guest
      .post(`/bookings/${booking.id}/end-early`)
      .send({ checkOut: inDays(1), refundCents: 0 })
      .expect(409);

    expect(await read(booking.id)).toMatchObject({
      to: inDays(1),
      refundedAmountCents: null,
      refundOwedCents: null,
    });
    expect(gateway.refunds).toEqual([]);
  });

  it("takes the unused nights' refund after the payout back from the host's transfer", async () => {
    const booking = await begun();
    const transferId = `tr_${booking.id.replaceAll("-", "")}`;
    const paidOut = hostShare(booking.amountCents, NO_CENTS);

    payoutGateway.sent.set(transferId, paidOut);
    await app.get(PrismaService).booking.update({
      where: { id: booking.id },
      data: { transferId, paidOutAmountCents: paidOut, paidOutAt: new Date() },
    });

    await guest
      .post(`/bookings/${booking.id}/end-early`)
      .send({ checkOut: inDays(1), refundCents: 0 })
      .expect(204);
    await refundSent(booking.id);

    const owed = hostShare(
      booking.amountCents,
      cents(2 * listingInput.pricePerNightCents),
    );

    await waitUntil(() => Promise.resolve(payoutGateway.reversals.length > 0));
    expect(payoutGateway.reversals).toEqual([
      { transferId, amount: paidOut - owed },
    ]);

    const row = await app
      .get(PrismaService)
      .booking.findUniqueOrThrow({ where: { id: booking.id } });

    expect(row.paidOutAmountCents).toBe(owed);
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
