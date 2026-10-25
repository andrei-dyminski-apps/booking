import { tz } from "@date-fns/tz";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { parseISO } from "date-fns";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";
import {
  LeaseBusyError,
  whileLeased,
  type LeaseTiming,
} from "./../src/booking/infrastructure/booking-lease";
import { BookingRepository } from "./../src/booking/infrastructure/booking.repository";
import { PayoutRepository } from "./../src/payout/infrastructure/payout.repository";
import { PrismaService } from "./../src/prisma/prisma.service";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { resetQueue } from "./queue";

/**
 * The settlement lease is a column the database's clock decides, which the unit spec's fake
 * can only imitate. Called directly, two settlements of one stay must never be inside their
 * work at the same time, while those of two stays are free to overlap.
 */
describe("PayoutRepository settlement lease (e2e)", () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;
  let payoutRepository: PayoutRepository;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prismaService = app.get(PrismaService);
    payoutRepository = app.get(PayoutRepository);

    await resetDatabase(app);
  });

  afterEach(async () => {
    await app.close();
  });

  /** A confirmed stay to hold a lease on; the lease is a column of its row. */
  async function stay(index: number): Promise<string> {
    const guest = await prismaService.user.create({
      data: {
        name: `Lease Guest ${String(index)}`,
        email: `lease-guest-${String(index)}@example.com`,
        passwordHash: "hash",
      },
    });
    const host = await prismaService.user.create({
      data: {
        name: `Lease Host ${String(index)}`,
        email: `lease-host-${String(index)}@example.com`,
        passwordHash: "hash",
      },
    });
    const listing = await prismaService.listing.create({
      data: {
        ownerId: host.id,
        title: "Cabin by the lake",
        description: "Two rooms, a jetty and no neighbours.",
        pricePerNight: 120,
        capacity: 4,
      },
    });
    const booking = await prismaService.booking.create({
      data: {
        listingId: listing.id,
        guestId: guest.id,
        from: parseISO(inDays(10), { in: tz("UTC") }),
        to: parseISO(inDays(12), { in: tz("UTC") }),
        status: "CONFIRMED",
        amount: 240,
      },
    });

    return booking.id;
  }

  /** Records when it entered and left, with a pause between that a rival would slip into. */
  function settling(bookingId: string, trace: string[], name: string) {
    return payoutRepository.whileSettling(bookingId, async () => {
      trace.push(`${name}:in`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      trace.push(`${name}:out`);
    });
  }

  it("lets one settlement of a stay finish before the next one starts", async () => {
    const bookingId = await stay(1);
    const trace: string[] = [];

    await Promise.all([
      settling(bookingId, trace, "a"),
      settling(bookingId, trace, "b"),
    ]);

    expect(trace).toHaveLength(4);
    expect(trace[0]?.endsWith(":in")).toBe(true);
    expect(trace[1]).toBe(trace[0]?.replace(":in", ":out"));
  });

  it("does not make the settlements of two stays wait for each other", async () => {
    const [first, second] = await Promise.all([stay(1), stay(2)]);
    const trace: string[] = [];

    await Promise.all([
      settling(first, trace, "a"),
      settling(second, trace, "b"),
    ]);

    expect(trace.slice(0, 2).sort()).toEqual(["a:in", "b:in"]);
  });

  it("lets the lease go when the work is done, and when it throws", async () => {
    const bookingId = await stay(1);
    const lease = async () =>
      (
        await prismaService.booking.findUniqueOrThrow({
          where: { id: bookingId },
        })
      ).settlingUntil;

    await payoutRepository.whileSettling(bookingId, async () => {
      expect(await lease()).not.toBeNull();
    });
    expect(await lease()).toBeNull();

    await expect(
      payoutRepository.whileSettling(bookingId, () =>
        Promise.reject(new Error("stripe down")),
      ),
    ).rejects.toThrow("stripe down");
    expect(await lease()).toBeNull();
  });

  it("keeps a lease past its length while the work under it still runs", async () => {
    const bookingId = await stay(1);
    // A lease a fifth of the work's length, renewed every third of it.
    const timing: LeaseTiming = {
      leaseMs: 300,
      waitMs: 900,
      pollMs: 50,
      pollMaxMs: 100,
    };
    const holding = whileLeased(
      prismaService,
      "settling_until",
      bookingId,
      timing,
      () => new Promise((resolve) => setTimeout(resolve, 1_500)),
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    await expect(
      whileLeased(prismaService, "settling_until", bookingId, timing, () =>
        Promise.resolve("rival"),
      ),
    ).rejects.toBeInstanceOf(LeaseBusyError);

    await holding;

    const { settlingUntil } = await prismaService.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });

    expect(settlingUntil).toBeNull();
  });

  it("takes a lease whose holder died once it has run out", async () => {
    const bookingId = await stay(1);

    await prismaService.booking.update({
      where: { id: bookingId },
      data: { settlingUntil: new Date(Date.now() - 1_000) },
    });

    await expect(
      payoutRepository.whileSettling(bookingId, () => Promise.resolve("ran")),
    ).resolves.toBe("ran");
  });
});

/**
 * The conditional writes and the sweep's cut, which the unit specs fake: what a stay's
 * refund total and dispute may move to, and which paid stays the sweep reads at all.
 */
describe("The money columns of a paid stay (e2e)", () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;
  let payoutRepository: PayoutRepository;
  let bookingRepository: BookingRepository;
  let bookingId: string;
  let hostId: string;

  const AMOUNT = 480;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prismaService = app.get(PrismaService);
    payoutRepository = app.get(PayoutRepository);
    bookingRepository = app.get(BookingRepository);

    await resetDatabase(app);
    await resetQueue(app);

    const guest = await prismaService.user.create({
      data: {
        name: "Money Guest",
        email: "money-guest@example.com",
        passwordHash: "hash",
      },
    });
    const host = await prismaService.user.create({
      data: {
        name: "Money Host",
        email: "money-host@example.com",
        passwordHash: "hash",
        stripeAccountId: "acct_money",
        payoutsEnabledAt: new Date(),
      },
    });
    const listing = await prismaService.listing.create({
      data: {
        ownerId: host.id,
        title: "Cabin by the lake",
        description: "Two rooms, a jetty and no neighbours.",
        pricePerNight: 120,
        capacity: 4,
      },
    });
    // Checked in ten days ago, so its payout is long due.
    const booking = await prismaService.booking.create({
      data: {
        listingId: listing.id,
        guestId: guest.id,
        from: parseISO(inDays(-10), { in: tz("UTC") }),
        to: parseISO(inDays(-6), { in: tz("UTC") }),
        status: "CONFIRMED",
        amount: AMOUNT,
        paymentIntentId: "pi_money",
        chargeId: "ch_money",
        paidAt: new Date(),
      },
    });

    bookingId = booking.id;
    hostId = host.id;
  });

  afterEach(async () => {
    await app.close();
  });

  const refundedAmount = async (): Promise<number | null> =>
    (
      await prismaService.booking.findUniqueOrThrow({
        where: { id: bookingId },
      })
    ).refundedAmount?.toNumber() ?? null;

  it("keeps a dashboard refund when a cancellation gives nothing back", async () => {
    await bookingRepository.raiseRefunded(bookingId, null, 100);

    await expect(
      bookingRepository.cancel(bookingId, "CONFIRMED", null),
    ).resolves.not.toBeNull();

    expect(await refundedAmount()).toBe(100);
  });

  it("raises the refund total with a cancellation's refund and never lowers it", async () => {
    await bookingRepository.settleOwedRefund(bookingId, 100);
    expect(await refundedAmount()).toBe(100);

    // The webhook already recorded Stripe's total of the cancellation's own refund.
    await bookingRepository.raiseRefunded(bookingId, 100, AMOUNT);
    await bookingRepository.settleOwedRefund(bookingId, 380);

    expect(await refundedAmount()).toBe(AMOUNT);
  });

  it("keeps a stay out of the due payouts while a cancellation's refund is owed", async () => {
    await bookingRepository.cancel(bookingId, "CONFIRMED", AMOUNT);

    expect(
      await payoutRepository.findDuePayouts(new Date(), 10, hostId),
    ).toEqual([]);
    expect(await bookingRepository.findOwedRefunds(10)).toEqual([bookingId]);

    await bookingRepository.settleOwedRefund(bookingId, AMOUNT);

    expect(await bookingRepository.findOwedRefunds(10)).toEqual([]);
    expect(await refundedAmount()).toBe(AMOUNT);
  });

  it("leaves a stay refunded in full out of the due payouts", async () => {
    expect(
      await payoutRepository.findDuePayouts(new Date(), 10, hostId),
    ).toEqual([bookingId]);

    await bookingRepository.raiseRefunded(bookingId, null, 100);
    expect(
      await payoutRepository.findDuePayouts(new Date(), 10, hostId),
    ).toEqual([bookingId]);

    await bookingRepository.raiseRefunded(bookingId, 100, AMOUNT);
    expect(
      await payoutRepository.findDuePayouts(new Date(), 10, hostId),
    ).toEqual([]);
  });

  it("refuses money columns past what the guest paid, whoever writes them", async () => {
    await expect(
      bookingRepository.raiseRefunded(bookingId, null, AMOUNT + 1),
    ).rejects.toThrow();
    await expect(
      bookingRepository.cancel(bookingId, "CONFIRMED", 0),
    ).rejects.toThrow();
    await expect(
      prismaService.booking.update({
        where: { id: bookingId },
        data: { paidOutAmount: -1 },
      }),
    ).rejects.toThrow();
    expect(await refundedAmount()).toBeNull();
  });

  it("moves a dispute forward only", async () => {
    // The outcome delivered before the opening: the opening is old news.
    await expect(
      payoutRepository.setDisputeStatus(bookingId, "WON"),
    ).resolves.toBe(true);
    await expect(
      payoutRepository.setDisputeStatus(bookingId, "OPEN"),
    ).resolves.toBe(false);

    expect(
      (
        await prismaService.booking.findUniqueOrThrow({
          where: { id: bookingId },
        })
      ).disputeStatus,
    ).toBe("WON");
  });

  it("settles an open dispute", async () => {
    await payoutRepository.setDisputeStatus(bookingId, "OPEN");

    await expect(
      payoutRepository.setDisputeStatus(bookingId, "OPEN"),
    ).resolves.toBe(false);
    await expect(
      payoutRepository.setDisputeStatus(bookingId, "LOST"),
    ).resolves.toBe(true);
  });

  it("sets an owed refund aside on its last failed run, and leaves it out of the sweep", async () => {
    await bookingRepository.cancel(bookingId, "CONFIRMED", AMOUNT);

    await expect(
      bookingRepository.recordRefundFailure(bookingId, "refused", 2),
    ).resolves.toEqual({ attempts: 1, setAside: false });
    await expect(bookingRepository.findOwedRefunds(10)).resolves.toEqual([
      bookingId,
    ]);
    await expect(
      bookingRepository.recordRefundFailure(bookingId, "refused", 2),
    ).resolves.toEqual({ attempts: 2, setAside: true });
    await expect(bookingRepository.findOwedRefunds(10)).resolves.toEqual([]);
    // Set aside already: a later failure is nobody's news.
    await expect(
      bookingRepository.recordRefundFailure(bookingId, "refused", 2),
    ).resolves.toBeNull();
  });

  it("leaves a refund owed out of the sweep while a dispute is open", async () => {
    await bookingRepository.cancel(bookingId, "CONFIRMED", AMOUNT);
    await payoutRepository.setDisputeStatus(bookingId, "OPEN");

    await expect(bookingRepository.findOwedRefunds(10)).resolves.toEqual([]);

    await payoutRepository.setDisputeStatus(bookingId, "WON");

    await expect(bookingRepository.findOwedRefunds(10)).resolves.toEqual([
      bookingId,
    ]);
  });

  it("clears the failures of a refund once it is sent", async () => {
    await bookingRepository.cancel(bookingId, "CONFIRMED", AMOUNT);
    await bookingRepository.recordRefundFailure(bookingId, "refused", 5);
    await bookingRepository.settleOwedRefund(bookingId, AMOUNT);

    await expect(
      prismaService.booking.findUniqueOrThrow({ where: { id: bookingId } }),
    ).resolves.toMatchObject({ refundAttempts: 0, refundLastError: null });
  });

  it("sets a payout aside on its last failed run, and leaves it out of the sweep", async () => {
    await expect(
      payoutRepository.recordPayoutFailure(bookingId, "refused", 2),
    ).resolves.toEqual({ attempts: 1, setAside: false });
    await expect(
      payoutRepository.findDuePayouts(new Date(), 10, hostId),
    ).resolves.toEqual([bookingId]);
    await expect(
      payoutRepository.recordPayoutFailure(bookingId, "refused", 2),
    ).resolves.toEqual({ attempts: 2, setAside: true });
    await expect(
      payoutRepository.findDuePayouts(new Date(), 10, hostId),
    ).resolves.toEqual([]);
  });

  it("counts no failure of a payout that was sent", async () => {
    await payoutRepository.recordPayout(bookingId, "tr_money", 432);

    await expect(
      payoutRepository.recordPayoutFailure(bookingId, "settle failed", 2),
    ).resolves.toBeNull();
  });

  it("leaves a refund owed out of the sweep while its cancellation lease runs", async () => {
    await prismaService.booking.update({
      where: { id: bookingId },
      data: {
        refundOwed: 100,
        cancellingUntil: new Date(Date.now() + 60_000),
      },
    });

    await expect(bookingRepository.findOwedRefunds(10)).resolves.toEqual([]);

    await prismaService.booking.update({
      where: { id: bookingId },
      data: { cancellingUntil: new Date(Date.now() - 1_000) },
    });

    await expect(bookingRepository.findOwedRefunds(10)).resolves.toEqual([
      bookingId,
    ]);
  });
});
