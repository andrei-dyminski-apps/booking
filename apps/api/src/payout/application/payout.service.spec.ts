import { ConflictException, NotFoundException } from "@nestjs/common";
import { BookingStatus, hostShare, NotificationType } from "@repo/contracts";
import { PaymentNotConfirmedYetError } from "../../booking/domain/booking.errors";
import type { FakeNotificationService } from "../../notification/testing/notification-service.fakes";
import {
  addCents,
  cents,
  CURRENCY,
  NO_CENTS,
  subtractCents,
  type Cents,
} from "../../payment/domain/money";
import { SettlementInProgressError } from "../domain/payout.errors";
import type { HostAccountService } from "./host-account.service";
import {
  MAX_PAYOUT_ATTEMPTS,
  type PayoutService,
  type SettlementEvent,
} from "./payout.service";
import {
  ACCOUNT_ID,
  AMOUNT,
  BOOKING_ID,
  CHARGE_ID,
  FUTURE,
  HOST_ID,
  LISTING_ID,
  PAST,
  PAYMENT_ID,
  REFUNDED_180,
  REFUNDED_80,
  SHARE,
  SHARE_AFTER_180,
  SHARE_AFTER_80,
  type StoredStay,
} from "./testing/payout-fixtures.fakes";
import type { FakePayoutGateway } from "./testing/payout-gateway.fakes";
import type { FakePayoutJobs } from "./testing/payout-jobs.fakes";
import type { FakePayoutRepository } from "./testing/payout-repository.fakes";
import {
  createPayoutTestbed,
  storeHost,
  storePaidStay,
} from "./testing/payout.fakes";

/**
 * Paying a host and settling what they hold, against the fakes of `testing/` — the account
 * the payout goes to is `host-account.service.spec.ts`'s, built in the same module so an
 * account switched on or off is seen by the payouts.
 */
describe("PayoutService", () => {
  let service: PayoutService;
  let hostAccountService: HostAccountService;
  let payoutRepository: FakePayoutRepository;
  let payoutGateway: FakePayoutGateway;
  let payoutJobs: FakePayoutJobs;
  let notificationService: FakeNotificationService;

  const paidStay = (from: string, overrides: Partial<StoredStay> = {}) => {
    storePaidStay(payoutRepository, from, overrides);
  };

  const hostWith = (accountId: string | null, enabled: boolean) => {
    storeHost(payoutRepository, accountId, enabled);
  };

  const stored = (): StoredStay | undefined =>
    payoutRepository.stays.get(BOOKING_ID);

  const noticesOf = (type: NotificationType) =>
    notificationService.notices.filter(({ content }) => content.type === type);

  beforeEach(async () => {
    ({
      service,
      hostAccountService,
      payoutRepository,
      payoutGateway,
      payoutJobs,
      notificationService,
    } = await createPayoutTestbed());
  });

  describe("paying a host", () => {
    it("transfers the host's share once the stay has begun, and tells them", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);

      expect([...payoutGateway.transfers.values()]).toEqual([
        expect.objectContaining({
          accountId: ACCOUNT_ID,
          chargeId: CHARGE_ID,
          amount: SHARE,
        }),
      ]);
      expect(stored()).toMatchObject({
        transferId: "tr_1",
        paidOutAmountCents: SHARE,
      });
      const sent = noticesOf(NotificationType.PAYOUT_SENT);

      expect(sent.map(({ userId }) => userId)).toEqual([HOST_ID]);
      expect(sent[0]?.content.data).toMatchObject({
        amountCents: SHARE,
      });
    });

    it("counts a transfer Stripe refuses, and sets the payout aside after the last attempt", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      payoutGateway.refusingTransfers = true;

      await expect(service.payOut(BOOKING_ID)).rejects.toThrow(
        "The transfer was refused",
      );
      expect(payoutRepository.payoutFailures.get(BOOKING_ID)).toEqual({
        attempts: 1,
        setAside: false,
      });

      for (let run = 2; run < MAX_PAYOUT_ATTEMPTS; run += 1) {
        await expect(service.payOut(BOOKING_ID)).rejects.toThrow();
      }

      // The last attempt ends the retries: the job completes and the admins are told.
      await expect(service.payOut(BOOKING_ID)).resolves.toBe(false);
      expect(notificationService.toAdmins).toEqual([
        {
          type: NotificationType.PAYOUT_FAILED,
          data: {
            bookingId: BOOKING_ID,
            error: "Error: The transfer was refused",
          },
        },
      ]);
      await expect(service.payDuePayouts()).resolves.toBe(0);
      expect(payoutRepository.payoutFailures.get(BOOKING_ID)?.attempts).toBe(
        MAX_PAYOUT_ATTEMPTS,
      );
    });

    it("records a transfer found while setting the payout aside, tells the host and nobody else", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      payoutGateway.refusingTransfers = true;

      for (let run = 1; run < MAX_PAYOUT_ATTEMPTS; run += 1) {
        await expect(service.payOut(BOOKING_ID)).rejects.toThrow();
      }

      // Stripe made the transfer after all, though every run was answered with a refusal.
      payoutGateway.sent("tr_late", SHARE);

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(false);

      expect(stored()).toMatchObject({
        transferId: "tr_late",
        paidOutAmountCents: SHARE,
        payoutReservedCents: null,
      });
      expect(notificationService.toAdmins).toEqual([]);
      expect(payoutRepository.payoutFailures.get(BOOKING_ID)).toEqual({
        attempts: MAX_PAYOUT_ATTEMPTS,
        setAside: false,
      });
      expect(noticesOf(NotificationType.PAYOUT_SENT)).toEqual([
        {
          userId: HOST_ID,
          content: {
            type: NotificationType.PAYOUT_SENT,
            data: expect.objectContaining({
              amountCents: SHARE,
              withheldCents: NO_CENTS,
            }) as unknown,
          },
        },
      ]);
    });

    it("tells every admin of a transfer found for less than was reserved", async () => {
      const SHORT = cents(SHARE - 1_000);

      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      // An earlier reservation's transfer, which the lookup before sending answers with.
      payoutGateway.sent("tr_short", SHORT);

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);

      expect(stored()?.paidOutAmountCents).toBe(SHORT);
      expect(notificationService.toAdmins).toEqual([
        {
          type: NotificationType.PAYOUT_SHORTFALL,
          data: {
            bookingId: BOOKING_ID,
            reservedCents: SHARE,
            sentCents: SHORT,
            currency: CURRENCY,
          },
        },
      ]);
      expect(noticesOf(NotificationType.PAYOUT_SENT)).toHaveLength(1);
    });

    it("counts no failure when another run holds the stay's lease", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      payoutRepository.leaseTaken = true;

      for (let run = 1; run <= MAX_PAYOUT_ATTEMPTS; run += 1) {
        await expect(service.payOut(BOOKING_ID)).rejects.toBeInstanceOf(
          SettlementInProgressError,
        );
      }

      expect(payoutRepository.payoutFailures.has(BOOKING_ID)).toBe(false);
      expect(notificationService.toAdmins).toEqual([]);

      payoutRepository.leaseTaken = false;

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);
      expect(stored()?.paidOutAmountCents).toBe(SHARE);
    });

    it("hands a payout set aside back on an admin's word, and queues it at once", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      payoutGateway.refusingTransfers = true;

      for (let run = 1; run <= MAX_PAYOUT_ATTEMPTS; run += 1) {
        await service.payOut(BOOKING_ID).catch(() => undefined);
      }

      // The account put right, the payout is retried and goes out with a whole count again.
      payoutGateway.refusingTransfers = false;
      await service.retryStuckPayout(BOOKING_ID);

      expect(payoutRepository.payoutFailures.has(BOOKING_ID)).toBe(false);
      expect(payoutJobs.scheduled).toEqual([
        { bookingId: BOOKING_ID, runAt: expect.any(Date) as Date },
      ]);
      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);
    });

    it("refuses to retry a payout that owes the host nothing any more, as the list leaves it out", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      payoutGateway.refusingTransfers = true;

      for (let run = 1; run <= MAX_PAYOUT_ATTEMPTS; run += 1) {
        await service.payOut(BOOKING_ID).catch(() => undefined);
      }

      const stay = payoutRepository.stays.get(BOOKING_ID);

      if (stay === undefined) throw new Error("The stay is gone");

      stay.disputeStatus = "LOST";

      await expect(service.retryStuckPayout(BOOKING_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(payoutRepository.payoutFailures.get(BOOKING_ID)?.setAside).toBe(
        true,
      );
      expect(payoutJobs.scheduled).toEqual([]);
    });

    it("refuses to retry a payout an open dispute holds", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      payoutGateway.refusingTransfers = true;

      for (let run = 1; run <= MAX_PAYOUT_ATTEMPTS; run += 1) {
        await service.payOut(BOOKING_ID).catch(() => undefined);
      }

      const stay = payoutRepository.stays.get(BOOKING_ID);

      if (stay === undefined) throw new Error("The stay is gone");

      stay.disputeStatus = "OPEN";

      await expect(service.retryStuckPayout(BOOKING_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(payoutJobs.scheduled).toEqual([]);

      // Won, the stay owes the host again and the retry goes through.
      stay.disputeStatus = "WON";

      await service.retryStuckPayout(BOOKING_ID);

      expect(payoutJobs.scheduled).toHaveLength(1);
    });

    it("refuses to retry a payout not set aside, and a stay that is not there", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);

      await expect(service.retryStuckPayout(BOOKING_ID)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.retryStuckPayout(LISTING_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(payoutJobs.scheduled).toEqual([]);
    });

    it("sends nothing before the payout falls due", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(FUTURE);

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(false);
      expect(payoutGateway.transfers.size).toBe(0);
    });

    it("pays once however many runs reach the same stay", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);

      await service.payOut(BOOKING_ID);
      await service.payDuePayouts();
      await service.payOut(BOOKING_ID);

      expect(payoutGateway.transfers.size).toBe(1);
      expect(noticesOf(NotificationType.PAYOUT_SENT)).toHaveLength(1);
    });

    it("lets a host without a finished account wait, and pays them when Stripe says so", async () => {
      payoutGateway.enabled = false;
      hostWith(ACCOUNT_ID, false);
      paidStay(PAST);

      await expect(service.payDuePayouts()).resolves.toBe(0);
      expect(payoutGateway.transfers.size).toBe(0);

      payoutGateway.enabled = true;
      await hostAccountService.handleAccountEvent({
        kind: "account",
        eventId: "evt_account",
        type: "v2.core.account[configuration.recipient].capability_status_updated",
        accountId: ACCOUNT_ID,
      });

      expect(payoutJobs.hosts).toEqual([HOST_ID]);

      await service.payDuePayouts(HOST_ID);

      expect(stored()?.paidOutAmountCents).toBe(SHARE);
    });

    it("asks Stripe again before sending, and holds back a host whose account lapsed", async () => {
      // The stored flag still says the account can be paid; Stripe says it no longer can.
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      payoutGateway.enabled = false;

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(false);

      expect(payoutGateway.transfers.size).toBe(0);
      expect(payoutRepository.holders.get(HOST_ID)?.enabled).toBe(false);

      // Once Stripe reports the account able again, the payout goes out.
      payoutGateway.enabled = true;
      await hostAccountService.handleAccountEvent({
        kind: "account",
        eventId: "evt_account_back",
        type: "v2.core.account[configuration.recipient].capability_status_updated",
        accountId: ACCOUNT_ID,
      });
      await service.payDuePayouts(HOST_ID);

      expect(stored()?.paidOutAmountCents).toBe(SHARE);
      // The job and the inbox's worker wait on nobody, unlike the refresh above.
      expect(payoutGateway.askedBy).toEqual([
        "background",
        "background",
        "background",
      ]);
    });

    it("asks Stripe about a host's account once per run, however many stays it pays", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      const first = stored();

      if (first !== undefined) {
        payoutRepository.stays.set("second", { ...first, bookingId: "second" });
      }

      await expect(service.payDuePayouts()).resolves.toBe(2);

      expect(payoutGateway.askedBy).toEqual(["background"]);
    });

    it("pays nothing out of a refund a cancellation still owes the guest", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST, {
        status: BookingStatus.CANCELLED,
        refundOwedCents: AMOUNT,
      });

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(false);

      expect(payoutGateway.transfers.size).toBe(0);
    });

    it("records the transfer an earlier run sent and never recorded, and takes back the difference", async () => {
      hostWith(ACCOUNT_ID, true);
      // The first attempt sent the full share and died before writing it down; a refund of
      // 80 landed since, so the host is owed less now and the retry asks for less.
      paidStay(PAST, { refundedAmountCents: REFUNDED_80 });
      payoutGateway.transfers.set(`booking-${BOOKING_ID}-payout`, {
        bookingId: BOOKING_ID,
        accountId: ACCOUNT_ID,
        chargeId: CHARGE_ID,
        amount: SHARE,
        reservation: 1,
        currency: CURRENCY,
        description: "sent earlier",
        id: "tr_earlier",
      });

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);

      expect(payoutGateway.transfers.size).toBe(1);
      expect(stored()?.transferId).toBe("tr_earlier");
      expect([...payoutGateway.reversals.values()]).toEqual([
        {
          transferId: "tr_earlier",
          amount: subtractCents(SHARE, SHARE_AFTER_80),
        },
      ]);
      expect(stored()?.paidOutAmountCents).toBe(SHARE_AFTER_80);
      expect(noticesOf(NotificationType.PAYOUT_SENT)).toMatchObject([
        { content: { data: { amountCents: SHARE_AFTER_80 } } },
      ]);
    });

    it("pays a guest's late cancellation that refunded nothing", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST, { status: BookingStatus.CANCELLED });

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);
      expect(stored()?.paidOutAmountCents).toBe(SHARE);
    });

    it("leaves a stay refunded in full out of the sweep for good", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST, {
        status: BookingStatus.CANCELLED,
        refundedAmountCents: AMOUNT,
      });

      await expect(service.payDuePayouts()).resolves.toBe(0);
      expect(payoutGateway.askedBy).toEqual([]);
    });

    it("pays nothing for a stay refunded in full", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST, {
        status: BookingStatus.CANCELLED,
        refundedAmountCents: AMOUNT,
      });

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(false);
      expect(payoutGateway.transfers.size).toBe(0);
    });

    it("takes back what a refund landing mid-transfer no longer leaves the host", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      payoutRepository.racing = () => {
        const stay = stored();

        if (stay !== undefined) stay.refundedAmountCents = REFUNDED_80;
      };

      await service.payOut(BOOKING_ID);

      // The share of the 400 left is less than the share sent, and the difference goes back.
      expect([...payoutGateway.reversals.values()]).toEqual([
        { transferId: "tr_1", amount: subtractCents(SHARE, SHARE_AFTER_80) },
      ]);
      expect(stored()?.paidOutAmountCents).toBe(SHARE_AFTER_80);
    });

    it("tells the host of a payout whose settlement failed, and settles it on the retry", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      payoutRepository.racing = () => {
        const stay = stored();

        if (stay !== undefined) stay.refundedAmountCents = REFUNDED_80;
      };
      payoutGateway.failingReversals = 1;

      await expect(service.payOut(BOOKING_ID)).rejects.toThrow(
        "Stripe could not be reached",
      );

      expect(noticesOf(NotificationType.PAYOUT_SENT)).toMatchObject([
        { content: { data: { amountCents: SHARE } } },
      ]);
      expect(stored()?.paidOutAmountCents).toBe(SHARE);

      // The job comes again: nothing is sent twice, and the reversal goes out.
      await expect(service.payOut(BOOKING_ID)).resolves.toBe(false);

      expect(payoutGateway.transfers.size).toBe(1);
      expect(stored()?.paidOutAmountCents).toBe(SHARE_AFTER_80);
      expect(noticesOf(NotificationType.PAYOUT_SENT)).toHaveLength(1);
    });
  });

  describe("the fees of a host's cancellations", () => {
    const FEE = cents(10_000);

    /** A fee of the host; what is withheld of it already, the payout of `BOOKING_ID` kept back. */
    const owes = (amountCents: Cents, withheldCents = NO_CENTS): void => {
      const id = `fee_${String(payoutRepository.fees.length + 1)}`;

      payoutRepository.fees.push({
        id,
        hostId: HOST_ID,
        amountCents,
        withheldCents,
        waived: false,
      });

      if (withheldCents > 0) {
        payoutRepository.withhold(BOOKING_ID, id, withheldCents);
      }
    };

    it("keeps what the host owes back from their next payout, oldest fee first", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      owes(cents(4_000));
      owes(FEE);

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);

      const kept = cents(14_000);

      expect([...payoutGateway.transfers.values()]).toEqual([
        expect.objectContaining({ amount: subtractCents(SHARE, kept) }),
      ]);
      expect(stored()).toMatchObject({
        paidOutAmountCents: subtractCents(SHARE, kept),
        feeWithheldCents: kept,
      });
      expect(payoutRepository.fees.map((fee) => fee.withheldCents)).toEqual([
        4_000, 10_000,
      ]);
      expect(
        noticesOf(NotificationType.PAYOUT_SENT)[0]?.content.data,
      ).toMatchObject({
        amountCents: subtractCents(SHARE, kept),
        withheldCents: kept,
      });
    });

    it("sends no transfer when the fees take the whole share, and owes the rest on", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      owes(cents(50_000));

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);

      expect(payoutGateway.transfers.size).toBe(0);
      expect(stored()).toMatchObject({
        transferId: null,
        paidOutAmountCents: 0,
        feeWithheldCents: SHARE,
      });
      expect(payoutRepository.owedFeesOf(HOST_ID)).toBe(
        subtractCents(cents(50_000), SHARE),
      );
      // Paid out already: the sweep and the job find nothing left to send.
      await expect(service.payOut(BOOKING_ID)).resolves.toBe(false);
    });

    it("keeps a waived fee from the payout no more", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      owes(FEE);

      const [fee] = payoutRepository.fees;

      if (fee !== undefined) fee.waived = true;

      await service.payOut(BOOKING_ID);

      expect(stored()?.feeWithheldCents).toBe(0);
      expect(stored()?.paidOutAmountCents).toBe(SHARE);
    });

    it("withholds one debt once when two stays of the host are paid out at once", async () => {
      const OTHER = "4b5c6d7e-8f90-4a1b-9c2d-4e5f6a7b8c9d";

      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);

      const first = stored();

      if (first === undefined) throw new Error("The stay was not stored");

      payoutRepository.stays.set(OTHER, {
        ...first,
        bookingId: OTHER,
        paymentId: "pi_2",
        chargeId: "ch_2",
      });
      owes(FEE);

      await Promise.all([service.payOut(BOOKING_ID), service.payOut(OTHER)]);

      expect(
        [...payoutRepository.stays.values()].map(
          (stay) => stay.feeWithheldCents,
        ),
      ).toEqual(expect.arrayContaining([FEE, 0]));
      expect(payoutRepository.fees[0]?.withheldCents).toBe(FEE);
    });

    it("sends what the first run reserved on a retry, a fee written since left to the next payout", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      owes(FEE);
      payoutGateway.refusingTransfers = true;

      await expect(service.payOut(BOOKING_ID)).rejects.toThrow(
        "The transfer was refused",
      );
      // Reserved, not paid out: the fee is kept back already, no transfer recorded.
      expect(stored()).toMatchObject({
        payoutReservedCents: subtractCents(SHARE, FEE),
        feeWithheldCents: FEE,
        paidOutAmountCents: null,
      });

      owes(FEE);
      payoutGateway.refusingTransfers = false;

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);

      expect([...payoutGateway.transfers.values()]).toEqual([
        expect.objectContaining({ amount: subtractCents(SHARE, FEE) }),
      ]);
      expect(payoutRepository.reservations).toBe(1);
      expect(stored()).toMatchObject({
        payoutReservedCents: null,
        paidOutAmountCents: subtractCents(SHARE, FEE),
      });
      expect(payoutRepository.owedFeesOf(HOST_ID)).toBe(FEE);
    });

    it("records a transfer a run sent and never wrote, when a refund settles the stay", async () => {
      hostWith(ACCOUNT_ID, true);
      payoutGateway.sent("tr_1", SHARE);
      paidStay(PAST, {
        payoutReservedCents: SHARE,
        refundedAmountCents: REFUNDED_80,
      });

      await expect(service.settle(BOOKING_ID)).resolves.toBe(SHARE_AFTER_80);

      expect(stored()).toMatchObject({
        transferId: "tr_1",
        payoutReservedCents: null,
        paidOutAmountCents: SHARE_AFTER_80,
      });
      expect([...payoutGateway.reversals.values()]).toEqual([
        { transferId: "tr_1", amount: subtractCents(SHARE, SHARE_AFTER_80) },
      ]);
      // The host hears of the payout from the settlement that recorded it, as it stands now.
      expect(
        noticesOf(NotificationType.PAYOUT_SENT).map(
          ({ content }) => content.data,
        ),
      ).toEqual([expect.objectContaining({ amountCents: SHARE_AFTER_80 })]);
      expect(notificationService.toAdmins).toEqual([]);
    });

    it("hands back a reservation no transfer went out for once a refund leaves the stay owing less", async () => {
      hostWith(ACCOUNT_ID, true);
      owes(FEE, FEE);
      paidStay(PAST, {
        payoutReservedCents: subtractCents(SHARE, FEE),
        feeWithheldCents: FEE,
        refundedAmountCents: REFUNDED_180,
      });

      await expect(service.settle(BOOKING_ID)).resolves.toBeNull();

      expect(stored()).toMatchObject({
        payoutReservedCents: null,
        feeWithheldCents: 0,
        paidOutAmountCents: null,
      });
      expect(payoutRepository.owedFeesOf(HOST_ID)).toBe(FEE);

      // The next run reserves afresh from what the stay owes now.
      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);
      expect(stored()).toMatchObject({
        feeWithheldCents: FEE,
        paidOutAmountCents: subtractCents(SHARE_AFTER_180, FEE),
      });
    });

    it("sends nothing for a reservation a refund since has outgrown, and reserves afresh", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      owes(FEE);
      // Between the reservation and the transfer's lease, as a refund recorded then would.
      payoutRepository.beforePayingOut = () => {
        const stay = stored();

        if (stay !== undefined) stay.refundedAmountCents = REFUNDED_180;
      };

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(false);

      expect(payoutGateway.transfers.size).toBe(0);
      expect(stored()).toMatchObject({
        payoutReservedCents: null,
        feeWithheldCents: 0,
        paidOutAmountCents: null,
      });
      expect(payoutRepository.owedFeesOf(HOST_ID)).toBe(FEE);

      payoutRepository.beforePayingOut = null;

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);
      // The second reservation is a new request to Stripe, under a key of its own.
      expect([...payoutGateway.transfers.values()]).toEqual([
        expect.objectContaining({
          amount: subtractCents(SHARE_AFTER_180, FEE),
          reservation: 2,
        }),
      ]);
    });

    it("sends a retry of one reservation under that reservation's key", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      payoutGateway.refusingTransfers = true;

      await expect(service.payOut(BOOKING_ID)).rejects.toThrow(
        "The transfer was refused",
      );

      payoutGateway.refusingTransfers = false;

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);
      expect([...payoutGateway.transfers.values()]).toEqual([
        expect.objectContaining({ amount: SHARE, reservation: 1 }),
      ]);
    });

    it("hands the reservation back once the host's account can no longer receive transfers", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      owes(FEE);
      payoutGateway.refusingTransfers = true;

      await expect(service.payOut(BOOKING_ID)).rejects.toThrow(
        "The transfer was refused",
      );
      expect(stored()?.feeWithheldCents).toBe(FEE);

      // The capability lapsed: Stripe says so before the next run's transfer.
      payoutGateway.enabled = false;

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(false);

      expect(stored()).toMatchObject({
        payoutReservedCents: null,
        feeWithheldCents: 0,
        paidOutAmountCents: null,
      });
      expect(payoutRepository.owedFeesOf(HOST_ID)).toBe(FEE);

      // Able to receive again: the next run reserves afresh and keeps the fee back.
      payoutGateway.enabled = true;
      payoutGateway.refusingTransfers = false;
      hostWith(ACCOUNT_ID, true);

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);
      expect(stored()).toMatchObject({
        feeWithheldCents: FEE,
        paidOutAmountCents: subtractCents(SHARE, FEE),
      });
    });

    it("hands the reservation back of a host whose account is switched off already", async () => {
      owes(FEE, FEE);
      paidStay(PAST, {
        payoutReservedCents: subtractCents(SHARE, FEE),
        payoutReservations: 1,
        feeWithheldCents: FEE,
      });
      hostWith(ACCOUNT_ID, false);

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(false);

      expect(stored()).toMatchObject({
        payoutReservedCents: null,
        feeWithheldCents: 0,
      });
      expect(payoutRepository.owedFeesOf(HOST_ID)).toBe(FEE);
    });

    it("hands the reservation back once an account event switches the host off, without the stay's own job", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      owes(FEE);
      payoutGateway.refusingTransfers = true;

      await expect(service.payOut(BOOKING_ID)).rejects.toThrow(
        "The transfer was refused",
      );
      expect(stored()?.feeWithheldCents).toBe(FEE);

      payoutGateway.enabled = false;
      await hostAccountService.handleAccountEvent({
        kind: "account",
        eventId: "evt_account_off",
        type: "v2.core.account[configuration.recipient].capability_status_updated",
        accountId: ACCOUNT_ID,
      });

      // The switch queues the host's run, and the run reaches the reserved stay.
      expect(payoutJobs.hosts).toEqual([HOST_ID]);
      await service.payDuePayouts(HOST_ID);

      expect(stored()).toMatchObject({
        payoutReservedCents: null,
        feeWithheldCents: 0,
      });
      expect(payoutRepository.owedFeesOf(HOST_ID)).toBe(FEE);
      // Nothing reserved any more, so the sweep leaves the switched-off host alone.
      await expect(
        payoutRepository.findDuePayouts(new Date(), 10),
      ).resolves.toEqual([]);
    });

    it("hands the fees back from a payout set aside, and keeps them back again on the retry", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      owes(FEE);
      payoutGateway.refusingTransfers = true;

      for (let run = 1; run <= MAX_PAYOUT_ATTEMPTS; run += 1) {
        await service.payOut(BOOKING_ID).catch(() => undefined);
      }

      expect(payoutRepository.payoutFailures.get(BOOKING_ID)?.setAside).toBe(
        true,
      );
      // Nothing was sent, so nothing is withheld while it waits for a person.
      expect(stored()).toMatchObject({
        payoutReservedCents: null,
        feeWithheldCents: 0,
      });
      expect(payoutRepository.owedFeesOf(HOST_ID)).toBe(FEE);

      payoutGateway.refusingTransfers = false;
      await service.retryStuckPayout(BOOKING_ID);

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);
      expect(stored()).toMatchObject({
        paidOutAmountCents: subtractCents(SHARE, FEE),
        feeWithheldCents: FEE,
      });
    });

    it("hands a refund's shortfall back to the fee this stay kept it back for, not the newest", async () => {
      const SENT = cents(4_000);

      payoutGateway.sent("tr_1", SENT);
      owes(FEE, FEE);
      // A newer fee another stay's payout paid towards in part.
      owes(FEE);
      const [, newer] = payoutRepository.fees;

      if (newer === undefined) throw new Error("The fee was not stored");

      newer.withheldCents = cents(3_000);
      payoutRepository.withhold("another-stay", newer.id, 3_000);
      paidStay(PAST, {
        transferId: "tr_1",
        paidOutAmountCents: SENT,
        feeWithheldCents: FEE,
        amountCents: cents(16_471),
        refundedAmountCents: cents(9_412),
      });

      await service.settle(BOOKING_ID);

      expect(payoutRepository.fees.map((fee) => fee.withheldCents)).toEqual([
        6_000, 3_000,
      ]);
    });

    it("leaves a reservation the stay still covers to its payout run", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST, { payoutReservedCents: SHARE });

      await expect(service.settle(BOOKING_ID)).resolves.toBeNull();
      expect(stored()?.payoutReservedCents).toBe(SHARE);
      // Nothing to hand back, so nothing to ask Stripe either.
      expect(payoutGateway.lookups).toBe(0);
    });

    it("takes a later refund out of the transfer first, and hands the shortfall back to the fee", async () => {
      // 4 000 sent, 10 000 kept back; a refund leaves the host owed 6 000 in all.
      const SENT = cents(4_000);

      payoutGateway.sent("tr_1", SENT);
      owes(FEE, FEE);
      paidStay(PAST, {
        transferId: "tr_1",
        paidOutAmountCents: SENT,
        feeWithheldCents: FEE,
        amountCents: cents(16_471),
        refundedAmountCents: cents(9_412),
      });

      const owed = hostShare(cents(16_471), cents(9_412));

      expect(owed).toBe(6_000);

      await expect(service.settle(BOOKING_ID)).resolves.toBe(0);

      expect([...payoutGateway.reversals.values()]).toEqual([
        { transferId: "tr_1", amount: SENT },
      ]);
      expect(stored()).toMatchObject({
        paidOutAmountCents: 0,
        feeWithheldCents: owed,
      });
      // The 4 000 the stay no longer covers is owed again.
      expect(payoutRepository.owedFeesOf(HOST_ID)).toBe(
        subtractCents(FEE, owed),
      );
    });
  });

  describe("a refund the booking side recorded", () => {
    it("takes the host's share back after a payout, once", async () => {
      payoutGateway.sent("tr_1", SHARE);
      paidStay(PAST, {
        transferId: "tr_1",
        paidOutAmountCents: SHARE,
        refundedAmountCents: AMOUNT,
      });

      await service.settle(BOOKING_ID);
      await service.settle(BOOKING_ID);

      expect([...payoutGateway.reversals.entries()]).toEqual([
        [
          `booking-${BOOKING_ID}-reversal-${String(SHARE)}-0`,
          { transferId: "tr_1", amount: SHARE },
        ],
      ]);
      expect(stored()?.paidOutAmountCents).toBe(0);
    });

    it("takes back the difference once when two settlements race over one stay", async () => {
      payoutGateway.sent("tr_1", SHARE);
      paidStay(PAST, {
        transferId: "tr_1",
        paidOutAmountCents: SHARE,
        refundedAmountCents: AMOUNT,
      });

      await Promise.all([
        service.settle(BOOKING_ID),
        service.settle(BOOKING_ID),
      ]);

      const reversed = [...payoutGateway.reversals.values()].reduce(
        (sum, { amount }) => addCents(sum, amount),
        NO_CENTS,
      );

      expect(reversed).toBe(SHARE);
      expect(stored()?.paidOutAmountCents).toBe(0);
    });

    it("answers what the host is left holding", async () => {
      payoutGateway.sent("tr_1", SHARE);
      paidStay(PAST, {
        transferId: "tr_1",
        paidOutAmountCents: SHARE,
        refundedAmountCents: REFUNDED_80,
      });

      // The share of the 400 left.
      await expect(service.settle(BOOKING_ID)).resolves.toBe(SHARE_AFTER_80);
    });

    it("sizes a reversal from what Stripe holds, so one whose write was lost is not sent twice", async () => {
      payoutGateway.sent("tr_1", SHARE);
      // A first refund of 80 took its part back at Stripe, and the run died before writing it
      // down: the row still says the whole share.
      payoutGateway.reversals.set("lost", {
        transferId: "tr_1",
        amount: subtractCents(SHARE, SHARE_AFTER_80),
      });
      paidStay(PAST, {
        transferId: "tr_1",
        paidOutAmountCents: SHARE,
        refundedAmountCents: REFUNDED_180,
      });

      // Only the difference between the share of the 300 left and what is still held goes back.
      await expect(service.settle(BOOKING_ID)).resolves.toBe(SHARE_AFTER_180);
      expect(
        payoutGateway.reversals.get(
          `booking-${BOOKING_ID}-reversal-${String(SHARE_AFTER_80)}-${String(SHARE_AFTER_180)}`,
        ),
      ).toEqual({
        transferId: "tr_1",
        amount: subtractCents(SHARE_AFTER_80, SHARE_AFTER_180),
      });
      expect(stored()?.paidOutAmountCents).toBe(SHARE_AFTER_180);
    });

    it("only writes down a reversal Stripe already holds", async () => {
      payoutGateway.sent("tr_1", SHARE);
      payoutGateway.reversals.set("lost", {
        transferId: "tr_1",
        amount: subtractCents(SHARE, SHARE_AFTER_80),
      });
      paidStay(PAST, {
        transferId: "tr_1",
        paidOutAmountCents: SHARE,
        refundedAmountCents: REFUNDED_80,
      });

      await expect(service.settle(BOOKING_ID)).resolves.toBe(SHARE_AFTER_80);
      expect(payoutGateway.reversals.size).toBe(1);
      expect(stored()?.paidOutAmountCents).toBe(SHARE_AFTER_80);
    });
  });

  describe("a dispute", () => {
    const disputed: SettlementEvent = {
      kind: "disputed",
      eventId: "evt_d",
      type: "charge.dispute.created",
      paymentId: PAYMENT_ID,
    };

    const closed = (won: boolean): SettlementEvent => ({
      kind: "disputeClosed",
      eventId: "evt_c",
      type: "charge.dispute.closed",
      paymentId: PAYMENT_ID,
      won,
    });

    it("has a dispute that arrives before its payment's news come again", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST, { status: BookingStatus.PENDING_PAYMENT, paid: false });

      await expect(
        service.handleSettlementEvent(disputed),
      ).rejects.toBeInstanceOf(PaymentNotConfirmedYetError);
      expect(stored()?.disputeStatus).toBeNull();
      expect(noticesOf(NotificationType.PAYMENT_DISPUTED)).toEqual([]);
    });

    it("holds the payout back and tells the host, once", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);

      await service.handleSettlementEvent(disputed);
      await service.handleSettlementEvent(disputed);
      await service.payDuePayouts();

      expect(stored()?.disputeStatus).toBe("OPEN");
      expect(payoutGateway.transfers.size).toBe(0);
      expect(noticesOf(NotificationType.PAYMENT_DISPUTED)).toHaveLength(1);
    });

    it("hands back a reservation the dispute holds, and keeps the fees back again once it is won", async () => {
      const FEE = cents(10_000);

      hostWith(ACCOUNT_ID, true);
      payoutRepository.fees.push({
        id: "fee_1",
        hostId: HOST_ID,
        amountCents: FEE,
        withheldCents: FEE,
        waived: false,
      });
      payoutRepository.withhold(BOOKING_ID, "fee_1", FEE);
      // Reserved by a run that died before its transfer.
      paidStay(PAST, {
        payoutReservedCents: subtractCents(SHARE, FEE),
        payoutReservations: 1,
        feeWithheldCents: FEE,
      });

      await service.handleSettlementEvent(disputed);

      expect(stored()).toMatchObject({
        disputeStatus: "OPEN",
        payoutReservedCents: null,
        feeWithheldCents: 0,
      });
      expect(payoutRepository.owedFeesOf(HOST_ID)).toBe(FEE);

      await service.handleSettlementEvent(closed(true));
      await service.payOut(BOOKING_ID);

      expect(stored()).toMatchObject({
        paidOutAmountCents: subtractCents(SHARE, FEE),
        feeWithheldCents: FEE,
      });
    });

    it("has the dispute come again while another run holds the lease, and hands the reservation back then", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST, {
        payoutReservedCents: SHARE,
        payoutReservations: 1,
      });
      payoutRepository.leaseTaken = true;

      await expect(
        service.handleSettlementEvent(disputed),
      ).rejects.toBeInstanceOf(SettlementInProgressError);
      expect(stored()).toMatchObject({
        disputeStatus: "OPEN",
        payoutReservedCents: SHARE,
      });

      payoutRepository.leaseTaken = false;
      await service.handleSettlementEvent(disputed);

      expect(stored()?.payoutReservedCents).toBeNull();
      // Told by the delivery that opened it, not again by the retry.
      expect(noticesOf(NotificationType.PAYMENT_DISPUTED)).toHaveLength(1);
    });

    it("hands back a reservation a dispute opened since holds, rather than sending it", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      payoutRepository.beforePayingOut = () => {
        const stay = stored();

        if (stay !== undefined) stay.disputeStatus = "OPEN";
      };

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(false);

      expect(payoutGateway.transfers.size).toBe(0);
      expect(stored()).toMatchObject({
        payoutReservedCents: null,
        feeWithheldCents: 0,
        paidOutAmountCents: null,
      });
    });

    it("leaves a payout already sent alone while the dispute is open", async () => {
      payoutGateway.sent("tr_1", SHARE);
      paidStay(PAST, { transferId: "tr_1", paidOutAmountCents: SHARE });

      await service.handleSettlementEvent(disputed);

      expect(payoutGateway.reversals.size).toBe(0);
    });

    it("queues the host's payout once a dispute is won, and the job pays it", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);

      await service.handleSettlementEvent(disputed);
      await service.handleSettlementEvent(closed(true));

      // The delivery sends nothing itself: a transfer Stripe refuses must not fail it.
      expect(payoutGateway.transfers.size).toBe(0);
      expect(payoutJobs.scheduled.map(({ bookingId }) => bookingId)).toEqual([
        BOOKING_ID,
      ]);

      await service.payOut(BOOKING_ID);

      expect(stored()).toMatchObject({
        disputeStatus: "WON",
        paidOutAmountCents: SHARE,
      });
    });

    it("keeps a won dispute won when its opening is delivered last", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);

      await service.handleSettlementEvent(closed(true));
      await service.handleSettlementEvent(disputed);
      await service.payOut(BOOKING_ID);

      expect(stored()).toMatchObject({
        disputeStatus: "WON",
        paidOutAmountCents: SHARE,
      });
      expect(noticesOf(NotificationType.PAYMENT_DISPUTED)).toEqual([]);
    });

    it("takes the whole payout back once a dispute is lost", async () => {
      payoutGateway.sent("tr_1", SHARE);
      paidStay(PAST, { transferId: "tr_1", paidOutAmountCents: SHARE });

      await service.handleSettlementEvent(disputed);
      await service.handleSettlementEvent(closed(false));

      expect([...payoutGateway.reversals.values()]).toEqual([
        { transferId: "tr_1", amount: SHARE },
      ]);
      expect(stored()).toMatchObject({
        disputeStatus: "LOST",
        paidOutAmountCents: NO_CENTS,
      });
    });
  });

  it("schedules a stay's payout a day after its check-in", async () => {
    await service.schedule({ bookingId: BOOKING_ID, from: "2030-10-14" });

    expect(payoutJobs.scheduled).toEqual([
      { bookingId: BOOKING_ID, runAt: new Date("2030-10-15T00:00:00.000Z") },
    ]);
  });
});
