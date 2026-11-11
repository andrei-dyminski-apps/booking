import { randomUUID } from "node:crypto";
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
import { BookingCancellationRepository } from "./../src/booking/infrastructure/booking-cancellation.repository";
import { BookingRefundRepository } from "./../src/booking/infrastructure/booking-refund.repository";
import { cents } from "./../src/payment/domain/money";
import {
  WaivingAccountGoneError,
  WaivingAccountNotAdminError,
} from "./../src/payout/domain/payout.errors";
import { HostFeeRepository } from "./../src/payout/infrastructure/host-fee.repository";
import {
  lockHostFees,
  PayoutRepository,
} from "./../src/payout/infrastructure/payout.repository";
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
        pricePerNightCents: 12_000,
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
        amountCents: 24_000,
        currency: "usd",
        cancellationPolicy: "FLEXIBLE",
        discountCents: 0,
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

  it("runs the work at once for a stay that is gone, rather than waiting for a lease", async () => {
    // A wait long enough that ending in time can only mean it never waited.
    const timing: LeaseTiming = {
      leaseMs: 60_000,
      waitMs: 60_000,
      pollMs: 50,
      pollMaxMs: 100,
    };
    const started = Date.now();

    await expect(
      whileLeased(prismaService, "settling_until", randomUUID(), timing, () =>
        Promise.resolve("ran"),
      ),
    ).resolves.toBe("ran");
    expect(Date.now() - started).toBeLessThan(1_000);
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
  let bookingCancellationRepository: BookingCancellationRepository;
  let bookingRefundRepository: BookingRefundRepository;
  let bookingId: string;
  let hostId: string;

  const AMOUNT = 48_000;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prismaService = app.get(PrismaService);
    payoutRepository = app.get(PayoutRepository);
    bookingCancellationRepository = app.get(BookingCancellationRepository);
    bookingRefundRepository = app.get(BookingRefundRepository);

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
        pricePerNightCents: 12_000,
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
        amountCents: AMOUNT,
        currency: "usd",
        cancellationPolicy: "FLEXIBLE",
        discountCents: 0,
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

  const refundedAmountCents = async (): Promise<number | null> =>
    (
      await prismaService.booking.findUniqueOrThrow({
        where: { id: bookingId },
      })
    ).refundedAmountCents;

  it("keeps a dashboard refund when a cancellation gives nothing back", async () => {
    await bookingRefundRepository.raiseRefunded(bookingId, null, cents(10_000));

    await expect(
      bookingCancellationRepository.cancel(bookingId, "CONFIRMED", null),
    ).resolves.not.toBeNull();

    expect(await refundedAmountCents()).toBe(10_000);
  });

  it("raises the refund total with a cancellation's refund and never lowers it", async () => {
    await bookingRefundRepository.settleOwedRefund(bookingId, cents(10_000));
    expect(await refundedAmountCents()).toBe(10_000);

    // The webhook already recorded Stripe's total of the cancellation's own refund.
    await bookingRefundRepository.raiseRefunded(
      bookingId,
      cents(10_000),
      cents(AMOUNT),
    );
    await bookingRefundRepository.settleOwedRefund(bookingId, cents(38_000));

    expect(await refundedAmountCents()).toBe(AMOUNT);
  });

  it("keeps a stay out of the due payouts while a cancellation's refund is owed", async () => {
    await bookingCancellationRepository.cancel(
      bookingId,
      "CONFIRMED",
      cents(AMOUNT),
    );

    expect(
      await payoutRepository.findDuePayouts(new Date(), 10, hostId),
    ).toEqual([]);
    expect(await bookingRefundRepository.findOwedRefunds(10)).toEqual([
      bookingId,
    ]);

    await bookingRefundRepository.settleOwedRefund(bookingId, cents(AMOUNT));

    expect(await bookingRefundRepository.findOwedRefunds(10)).toEqual([]);
    expect(await refundedAmountCents()).toBe(AMOUNT);
  });

  it("leaves a stay refunded in full out of the due payouts", async () => {
    expect(
      await payoutRepository.findDuePayouts(new Date(), 10, hostId),
    ).toEqual([bookingId]);

    await bookingRefundRepository.raiseRefunded(bookingId, null, cents(10_000));
    expect(
      await payoutRepository.findDuePayouts(new Date(), 10, hostId),
    ).toEqual([bookingId]);

    await bookingRefundRepository.raiseRefunded(
      bookingId,
      cents(10_000),
      cents(AMOUNT),
    );
    expect(
      await payoutRepository.findDuePayouts(new Date(), 10, hostId),
    ).toEqual([]);
  });

  it("refuses money columns past what the guest paid, whoever writes them", async () => {
    await expect(
      bookingRefundRepository.raiseRefunded(bookingId, null, cents(AMOUNT + 1)),
    ).rejects.toThrow();
    await expect(
      bookingCancellationRepository.cancel(bookingId, "CONFIRMED", cents(0)),
    ).rejects.toThrow();
    await expect(
      prismaService.booking.update({
        where: { id: bookingId },
        data: { paidOutAmountCents: -1 },
      }),
    ).rejects.toThrow();
    expect(await refundedAmountCents()).toBeNull();
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
    await bookingCancellationRepository.cancel(
      bookingId,
      "CONFIRMED",
      cents(AMOUNT),
    );

    await expect(
      bookingRefundRepository.recordRefundFailure(bookingId, "refused", 2),
    ).resolves.toEqual({ attempts: 1, setAside: false });
    await expect(bookingRefundRepository.findOwedRefunds(10)).resolves.toEqual([
      bookingId,
    ]);
    await expect(
      bookingRefundRepository.recordRefundFailure(bookingId, "refused", 2),
    ).resolves.toEqual({ attempts: 2, setAside: true });
    await expect(bookingRefundRepository.findOwedRefunds(10)).resolves.toEqual(
      [],
    );
    // Set aside already: a later failure is nobody's news.
    await expect(
      bookingRefundRepository.recordRefundFailure(bookingId, "refused", 2),
    ).resolves.toBeNull();
  });

  it("leaves a refund owed out of the sweep while a dispute is open", async () => {
    await bookingCancellationRepository.cancel(
      bookingId,
      "CONFIRMED",
      cents(AMOUNT),
    );
    await payoutRepository.setDisputeStatus(bookingId, "OPEN");

    await expect(bookingRefundRepository.findOwedRefunds(10)).resolves.toEqual(
      [],
    );

    await payoutRepository.setDisputeStatus(bookingId, "WON");

    await expect(bookingRefundRepository.findOwedRefunds(10)).resolves.toEqual([
      bookingId,
    ]);
  });

  it("clears the failures of a refund once it is sent", async () => {
    await bookingCancellationRepository.cancel(
      bookingId,
      "CONFIRMED",
      cents(AMOUNT),
    );
    await bookingRefundRepository.recordRefundFailure(bookingId, "refused", 5);
    await bookingRefundRepository.settleOwedRefund(bookingId, cents(AMOUNT));

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
    await payoutRepository.reservePayout(bookingId, hostId, () => ({
      send: cents(43_200),
      withheld: cents(0),
    }));
    await payoutRepository.whilePayingOut(bookingId, (_stay, record) =>
      record({ transferId: "tr_money", sent: cents(43_200) }),
    );

    await expect(
      payoutRepository.recordPayoutFailure(bookingId, "settle failed", 2),
    ).resolves.toBeNull();
  });

  describe("the fees of a host's cancellations", () => {
    const FEE = 10_000;

    let stays = 0;

    /** Another stay of the same host, paid and due — a payout to race the first one. */
    async function secondStay(): Promise<string> {
      stays += 1;

      const first = await prismaService.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      const other = await prismaService.booking.create({
        data: {
          listingId: first.listingId,
          guestId: first.guestId,
          from: parseISO(inDays(-20 * stays), { in: tz("UTC") }),
          to: parseISO(inDays(-20 * stays + 4), { in: tz("UTC") }),
          status: "CONFIRMED",
          amountCents: AMOUNT,
          currency: "usd",
          cancellationPolicy: "FLEXIBLE",
          discountCents: 0,
          paymentIntentId: `pi_money_${String(stays)}`,
          chargeId: `ch_money_${String(stays)}`,
          paidAt: new Date(),
        },
      });

      return other.id;
    }

    /** A fee the host owes for a stay they cancelled, written as the cancellation writes it. */
    async function owes(amountCents: number): Promise<string> {
      const cancelled = await secondStay();

      await prismaService.booking.update({
        where: { id: cancelled },
        data: {
          status: "CANCELLED",
          cancelledBy: "HOST",
          cancelledAt: new Date(),
          paidOutAt: new Date(),
        },
      });

      return (
        await prismaService.hostFee.create({
          data: {
            bookingId: cancelled,
            hostId,
            amountCents,
            currency: "usd",
          },
        })
      ).id;
    }

    /** A payout's two steps: the reservation keeps back what the host owes, then the record. */
    const payOut = async (id: string, share: number) => {
      const reserved = await payoutRepository.reservePayout(
        id,
        hostId,
        (owedFees) => {
          const withheld = Math.min(share, owedFees);

          return { send: cents(share - withheld), withheld: cents(withheld) };
        },
      );

      if (!reserved) return false;

      return payoutRepository.whilePayingOut(id, (stay, record) =>
        record({
          transferId: `tr_${id}`,
          sent: stay?.payoutReservedCents ?? cents(0),
        }),
      );
    };

    it("keeps one debt back once when two payouts of the host run at once", async () => {
      const feeId = await owes(FEE);
      const other = await secondStay();

      await Promise.all([payOut(bookingId, 40_800), payOut(other, 40_800)]);

      const kept = await prismaService.booking.findMany({
        where: { id: { in: [bookingId, other] } },
        select: { feeWithheldCents: true, payoutReservedCents: true },
      });

      expect(kept.map((row) => row.feeWithheldCents).sort()).toEqual([0, FEE]);
      // Spent with the record.
      expect(kept.map((row) => row.payoutReservedCents)).toEqual([null, null]);
      await expect(
        prismaService.hostFee.findUniqueOrThrow({ where: { id: feeId } }),
      ).resolves.toMatchObject({ withheldCents: FEE });
      // Paid out, so out of the sweep: no transfer is the marker no longer.
      expect(
        await payoutRepository.findDuePayouts(new Date(), 10, hostId),
      ).toEqual([]);
    });

    it("leaves the reservation already written to a retry, whatever the fees say now", async () => {
      await owes(FEE);

      const split = (owedFees: number) => ({
        send: cents(40_800 - Math.min(40_800, owedFees)),
        withheld: cents(Math.min(40_800, owedFees)),
      });
      const reserved = () =>
        prismaService.booking.findUniqueOrThrow({
          where: { id: bookingId },
          select: { payoutReservedCents: true, feeWithheldCents: true },
        });

      await expect(
        payoutRepository.reservePayout(bookingId, hostId, split),
      ).resolves.toBe(true);

      const first = await reserved();

      // A fee written between the two runs is left to the next payout.
      await owes(FEE);

      await expect(
        payoutRepository.reservePayout(bookingId, hostId, split),
      ).resolves.toBe(true);
      await expect(reserved()).resolves.toEqual(first);
      expect(first).toEqual({
        payoutReservedCents: 30_800,
        feeWithheldCents: FEE,
      });
    });

    it("hands a released reservation's withheld back to the fee, and only the reservation read", async () => {
      const feeId = await owes(FEE);

      await payoutRepository.reservePayout(bookingId, hostId, () => ({
        send: cents(30_800),
        withheld: cents(FEE),
      }));

      const released = await payoutRepository.whileSettling(
        bookingId,
        async (_stay, writes) => [
          await writes.release({ send: cents(40_800), withheld: cents(0) }),
          await writes.release({ send: cents(30_800), withheld: cents(FEE) }),
        ],
      );

      expect(released).toEqual([false, true]);
      await expect(
        prismaService.hostFee.findUniqueOrThrow({ where: { id: feeId } }),
      ).resolves.toMatchObject({ withheldCents: 0 });
      await expect(
        prismaService.booking.findUniqueOrThrow({ where: { id: bookingId } }),
      ).resolves.toMatchObject({
        payoutReservedCents: null,
        feeWithheldCents: 0,
      });
    });

    it("refuses money kept back by a stay neither reserved nor paid out", async () => {
      await expect(
        prismaService.booking.update({
          where: { id: bookingId },
          data: { feeWithheldCents: FEE },
        }),
      ).rejects.toThrow();
    });

    it("hands what a settlement no longer keeps back to the fee, as debt", async () => {
      const feeId = await owes(FEE);

      await payOut(bookingId, 40_800);
      await payoutRepository.whileSettling(bookingId, (_stay, writes) =>
        writes.settlement(
          { paidOut: cents(30_800), withheld: cents(FEE) },
          { paidOut: cents(0), withheld: cents(6_000) },
        ),
      );

      await expect(
        prismaService.hostFee.findUniqueOrThrow({ where: { id: feeId } }),
      ).resolves.toMatchObject({ withheldCents: 6_000 });
      await expect(
        prismaService.booking.findUniqueOrThrow({ where: { id: bookingId } }),
      ).resolves.toMatchObject({
        paidOutAmountCents: 0,
        feeWithheldCents: 6_000,
      });
    });

    it("hands a shortfall back to the fee this stay kept it back for, not to the newest", async () => {
      const older = await owes(FEE);

      await payOut(bookingId, 40_800);

      // A newer fee, which another stay's payout paid 4 000 towards.
      const newer = await owes(FEE);
      const other = await secondStay();

      await payOut(other, 4_000);
      await payoutRepository.whileSettling(bookingId, (_stay, writes) =>
        writes.settlement(
          { paidOut: cents(30_800), withheld: cents(FEE) },
          { paidOut: cents(0), withheld: cents(6_000) },
        ),
      );

      const withheldOf = async (id: string) =>
        (await prismaService.hostFee.findUniqueOrThrow({ where: { id } }))
          .withheldCents;

      expect(await withheldOf(older)).toBe(6_000);
      expect(await withheldOf(newer)).toBe(4_000);
      await expect(
        prismaService.hostFeeWithholding.findMany({
          orderBy: { amountCents: "asc" },
          select: { bookingId: true, hostFeeId: true, amountCents: true },
        }),
      ).resolves.toEqual([
        { bookingId: other, hostFeeId: newer, amountCents: 4_000 },
        { bookingId, hostFeeId: older, amountCents: 6_000 },
      ]);
    });

    it("drops what a released reservation kept back from the fees it went to", async () => {
      await owes(FEE);

      await payoutRepository.reservePayout(bookingId, hostId, () => ({
        send: cents(30_800),
        withheld: cents(FEE),
      }));
      await payoutRepository.whileSettling(bookingId, (_stay, writes) =>
        writes.release({ send: cents(30_800), withheld: cents(FEE) }),
      );

      await expect(prismaService.hostFeeWithholding.count()).resolves.toBe(0);
    });

    it("waits for the host's lock before waiving a fee", async () => {
      const feeId = await owes(FEE);
      const hostFeeRepository = app.get(HostFeeRepository);
      const admin = await prismaService.user.create({
        data: {
          name: "Money Admin",
          email: "money-admin@example.com",
          passwordHash: "hash",
          role: "ADMIN",
        },
      });
      let waived = false;
      let waiving: Promise<boolean> = Promise.resolve(false);

      // A reservation holding the lock between reading what is owed and keeping it back.
      await prismaService.$transaction(async (tx) => {
        await lockHostFees(tx, hostId);
        waiving = hostFeeRepository.waive(
          feeId,
          "A storm closed the road",
          admin.id,
        );
        void waiving.then(() => {
          waived = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 300));

        expect(waived).toBe(false);
      });

      await expect(waiving).resolves.toBe(true);
    });

    it("refuses a waiver that names no admin", async () => {
      const feeId = await owes(FEE);

      await expect(
        prismaService.hostFee.update({
          where: { id: feeId },
          data: { waivedAt: new Date(), waiveReason: "Nobody said who" },
        }),
      ).rejects.toThrow(/host_fees_waived_by_someone/);
    });

    it("refuses a waiver from an account gone, or no longer an active admin", async () => {
      const feeId = await owes(FEE);
      const hostFeeRepository = app.get(HostFeeRepository);
      // Both written the way the API cannot write them: a role, a block on an admin.
      const demoted = await prismaService.user.create({
        data: {
          name: "Former Admin",
          email: "former-admin@example.com",
          passwordHash: "hash",
        },
      });
      const blocked = await prismaService.user.create({
        data: {
          name: "Blocked Admin",
          email: "blocked-admin@example.com",
          passwordHash: "hash",
          role: "ADMIN",
          blockedAt: new Date(),
        },
      });

      await expect(
        hostFeeRepository.waive(feeId, "Gone", randomUUID()),
      ).rejects.toThrow(WaivingAccountGoneError);
      await expect(
        hostFeeRepository.waive(feeId, "Demoted", demoted.id),
      ).rejects.toThrow(WaivingAccountNotAdminError);
      await expect(
        hostFeeRepository.waive(feeId, "Blocked", blocked.id),
      ).rejects.toThrow(WaivingAccountNotAdminError);
      await expect(
        prismaService.hostFee.findUniqueOrThrow({ where: { id: feeId } }),
      ).resolves.toMatchObject({ waivedAt: null, waivedById: null });
    });

    it("refuses a fee withheld past its amount", async () => {
      const feeId = await owes(FEE);

      await expect(
        prismaService.hostFee.update({
          where: { id: feeId },
          data: { withheldCents: FEE + 1 },
        }),
      ).rejects.toThrow();
    });
  });

  it("leaves a refund owed out of the sweep while its cancellation lease runs", async () => {
    await prismaService.booking.update({
      where: { id: bookingId },
      data: {
        refundOwedCents: 10_000,
        cancellingUntil: new Date(Date.now() + 60_000),
      },
    });

    await expect(bookingRefundRepository.findOwedRefunds(10)).resolves.toEqual(
      [],
    );

    await prismaService.booking.update({
      where: { id: bookingId },
      data: { cancellingUntil: new Date(Date.now() - 1_000) },
    });

    await expect(bookingRefundRepository.findOwedRefunds(10)).resolves.toEqual([
      bookingId,
    ]);
  });
});
