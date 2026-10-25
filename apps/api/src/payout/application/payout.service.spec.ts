import { BadGatewayException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  BookingStatus,
  HostAccountStatus,
  NotificationType,
  payoutDueAt,
  Role,
  type DisputeStatus,
  type NotificationContent,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { PaymentNotConfirmedYetError } from "../../booking/domain/booking.errors";
import type { SetAside } from "../../common/job-failure";
import { NotificationService } from "../../notification/notification.service";
import type { PayoutAccountHolder, SettledStay } from "../domain/payout.types";
import { PayoutRepository } from "../infrastructure/payout.repository";
import {
  MAX_PAYOUT_ATTEMPTS,
  PayoutService,
  type SettlementEvent,
} from "./payout.service";
import {
  PayoutGateway,
  type AccountEvent,
  type Payout,
  type PayoutHost,
  type SentTransfer,
} from "./ports/payout-gateway";
import { PayoutJobs } from "./ports/payout-jobs";

const GUEST_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const HOST_ID = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";
const BOOKING_ID = "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b";
const LISTING_ID = "3a4b5c6d-7e8f-4091-8a2b-3c4d5e6f7a8b";
const ACCOUNT_ID = "acct_host";
const PAYMENT_ID = "pi_1";
const CHARGE_ID = "ch_1";

/** What the stay cost; the host's share of it is 432 after the platform's tenth. */
const AMOUNT = 480;
const SHARE = 432;

/** A check-in long enough ago that the payout is due, and one far enough ahead it is not. */
const PAST = "2026-01-10";
const FUTURE = "2099-01-10";

const host: AuthenticatedUser = {
  id: HOST_ID,
  email: "host@example.com",
  role: Role.USER,
};

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
type PublicOf<T> = { [K in keyof T]: T[K] };

/** The destination is read off the host whenever the stay is, as the real join does. */
type StoredStay = Omit<SettledStay, "destination"> & { paymentId: string };

/**
 * The stays and the payout accounts in memory. What the service decides — whether a payout
 * may go, how much, and what to take back — is asserted against what ends up stored here,
 * and the SQL behind each write is the e2e specs'. The conditional writes keep the shape of
 * the real ones: a transfer only into an empty column, a reversal only from the amount the
 * caller read, a refund total only upwards.
 */
class FakePayoutRepository implements PublicOf<PayoutRepository> {
  readonly stays = new Map<string, StoredStay>();
  readonly holders = new Map<string, PayoutAccountHolder>();

  /** Run just before `recordPayout` writes, as a refund racing the transfer would. */
  racing: (() => void) | null = null;

  findHolder(userId: string): Promise<PayoutAccountHolder | null> {
    return Promise.resolve(this.holders.get(userId) ?? null);
  }

  /** Set to have writing the account fail, as a database that went away would. */
  brokenAttach = false;

  attachAccount(userId: string, accountId: string): Promise<void> {
    if (this.brokenAttach) {
      return Promise.reject(new Error("connection refused"));
    }

    const holder = this.holders.get(userId);

    if (holder !== undefined && holder.accountId === null) {
      holder.accountId = accountId;
    }

    return Promise.resolve();
  }

  setPayoutsEnabled(
    accountId: string,
    enabled: boolean,
  ): Promise<{ userId: string; newlyEnabled: boolean } | null> {
    const found = [...this.holders.entries()].find(
      ([, holder]) => holder.accountId === accountId,
    );

    if (found === undefined) return Promise.resolve(null);

    const [userId, holder] = found;
    const newlyEnabled = enabled && !holder.enabled;

    holder.enabled = enabled;

    return Promise.resolve({ userId, newlyEnabled });
  }

  findStay(bookingId: string): Promise<SettledStay | null> {
    const stay = this.stays.get(bookingId);

    return Promise.resolve(stay === undefined ? null : this.settledOf(stay));
  }

  /** The lock of the real repository: one settlement per booking at a time, in arrival order. */
  private readonly settling = new Map<string, Promise<unknown>>();

  async whileSettling<T>(
    bookingId: string,
    work: (
      stay: SettledStay | null,
      recordReversal: (from: number, to: number) => Promise<boolean>,
    ) => Promise<T>,
  ): Promise<T> {
    const previous = this.settling.get(bookingId) ?? Promise.resolve();
    const run = previous.then(async () =>
      work(await this.findStay(bookingId), (from, to) =>
        this.recordReversal(bookingId, from, to),
      ),
    );

    this.settling.set(
      bookingId,
      run.catch(() => undefined),
    );

    return run;
  }

  findStayByPayment(paymentId: string): Promise<SettledStay | null> {
    const stay = [...this.stays.values()].find(
      (found) => found.paymentId === paymentId,
    );

    return Promise.resolve(stay === undefined ? null : this.settledOf(stay));
  }

  private settledOf(stay: StoredStay): SettledStay {
    const holder = this.holders.get(stay.hold.listingOwnerId);

    return {
      ...stay,
      destination: {
        accountId: holder?.accountId ?? null,
        enabled: holder?.enabled ?? false,
      },
    };
  }

  /** The failed payouts by booking, and whether each was set aside. */
  readonly payoutFailures = new Map<
    string,
    { attempts: number; setAside: boolean }
  >();

  recordPayoutFailure(
    bookingId: string,
    _error: string,
    maxAttempts: number,
  ): Promise<SetAside | null> {
    const stay = this.stays.get(bookingId);
    const failure = this.payoutFailures.get(bookingId) ?? {
      attempts: 0,
      setAside: false,
    };

    if (stay === undefined || stay.transferId !== null || failure.setAside) {
      return Promise.resolve(null);
    }

    failure.attempts += 1;
    failure.setAside = failure.attempts >= maxAttempts;
    this.payoutFailures.set(bookingId, failure);

    return Promise.resolve({ ...failure });
  }

  findDuePayouts(now: Date, limit: number, hostId?: string): Promise<string[]> {
    const attemptsOf = (bookingId: string) =>
      this.payoutFailures.get(bookingId)?.attempts ?? 0;

    return Promise.resolve(
      [...this.stays.values()]
        .filter(
          (stay) =>
            stay.paid &&
            stay.transferId === null &&
            this.payoutFailures.get(stay.bookingId)?.setAside !== true &&
            stay.refundOwed === null &&
            payoutDueAt(stay.hold.stay.from) <= now &&
            (stay.disputeStatus === null || stay.disputeStatus === "WON") &&
            (stay.refundedAmount === null ||
              stay.refundedAmount < stay.amount) &&
            this.holders.get(stay.hold.listingOwnerId)?.enabled === true &&
            (hostId === undefined || stay.hold.listingOwnerId === hostId),
        )
        .map((stay) => stay.bookingId)
        .sort((left, right) => attemptsOf(left) - attemptsOf(right))
        .slice(0, limit),
    );
  }

  recordPayout(
    bookingId: string,
    transferId: string,
    amount: number,
  ): Promise<boolean> {
    this.racing?.();

    const stay = this.stays.get(bookingId);

    if (stay === undefined || stay.transferId !== null) {
      return Promise.resolve(false);
    }

    stay.transferId = transferId;
    stay.paidOutAmount = amount;

    return Promise.resolve(true);
  }

  recordReversal(
    bookingId: string,
    from: number,
    to: number,
  ): Promise<boolean> {
    const stay = this.stays.get(bookingId);

    if (stay?.paidOutAmount !== from) return Promise.resolve(false);

    stay.paidOutAmount = to;

    return Promise.resolve(true);
  }

  /** Forward only: opened from none, settled from none or open. */
  setDisputeStatus(bookingId: string, status: DisputeStatus): Promise<boolean> {
    const stay = this.stays.get(bookingId);

    if (
      stay === undefined ||
      !(
        stay.disputeStatus === null ||
        (status !== "OPEN" && stay.disputeStatus === "OPEN")
      )
    ) {
      return Promise.resolve(false);
    }

    stay.disputeStatus = status;

    return Promise.resolve(true);
  }
}

/**
 * The provider's Connect half: transfers and reversals recorded by key, the way Stripe
 * treats them — a second call under a key already used is the same transfer, not another.
 */
class FakePayoutGateway implements PublicOf<PayoutGateway> {
  readonly accounts: PayoutHost[] = [];
  readonly transfers = new Map<string, Payout & { id: string }>();
  readonly reversals = new Map<
    string,
    { transferId: string; amount: number }
  >();

  /**
   * What `transfersEnabled` answers for any account. On by default: a spec about a host
   * Stripe says cannot be paid turns it off, the way a lapsed capability would.
   */
  enabled = true;

  /** How many times Stripe was asked about an account. */
  asked = 0;

  /** How many reversals fail before Stripe takes one, as a network that drops them would. */
  failingReversals = 0;

  /** Set to have Stripe refuse every transfer, as a restricted account's would be. */
  refusingTransfers = false;

  createRecipientAccount(host: PayoutHost): Promise<string> {
    this.accounts.push(host);

    return Promise.resolve(ACCOUNT_ID);
  }

  /** Set to have Stripe refuse the onboarding session, as an outage would. */
  refusingSessions = false;

  createAccountSession(accountId: string): Promise<string> {
    if (this.refusingSessions) {
      return Promise.reject(new Error("api_connection_error"));
    }

    return Promise.resolve(`${accountId}_session`);
  }

  transfersEnabled(): Promise<boolean> {
    this.asked += 1;

    return Promise.resolve(this.enabled);
  }

  transfer(payout: Payout): Promise<SentTransfer> {
    if (this.refusingTransfers) {
      return Promise.reject(new Error("The transfer was refused"));
    }

    const key = `booking-${payout.bookingId}-payout`;
    const sent = this.transfers.get(key) ?? {
      ...payout,
      id: `tr_${String(this.transfers.size + 1)}`,
    };

    this.transfers.set(key, sent);

    // The adapter answers a retry with the transfer already sent, whatever the retry asked.
    return Promise.resolve({ id: sent.id, amount: sent.amount });
  }

  /** A transfer an earlier run sent, as Stripe would hold it. */
  sent(id: string, amount: number): void {
    this.transfers.set(`booking-${BOOKING_ID}-payout`, {
      bookingId: BOOKING_ID,
      accountId: ACCOUNT_ID,
      chargeId: CHARGE_ID,
      amount,
      description: "sent earlier",
      id,
    });
  }

  /** What was sent less every reversal of it, the way Stripe reads `amount_reversed`. */
  heldOnTransfer(transferId: string): Promise<number> {
    const transfer = [...this.transfers.values()].find(
      ({ id }) => id === transferId,
    );

    if (transfer === undefined) {
      return Promise.reject(new Error(`No such transfer: ${transferId}`));
    }

    const reversed = [...this.reversals.values()]
      .filter((reversal) => reversal.transferId === transferId)
      .reduce((sum, { amount }) => sum + amount, 0);

    return Promise.resolve(
      Math.round((transfer.amount - reversed) * 100) / 100,
    );
  }

  reverseTransfer(
    transferId: string,
    amount: number,
    key: string,
  ): Promise<void> {
    if (this.failingReversals > 0) {
      this.failingReversals -= 1;

      return Promise.reject(new Error("Stripe could not be reached"));
    }

    if (!this.reversals.has(key))
      this.reversals.set(key, { transferId, amount });

    // A real call takes a network round trip, which is when a second settlement arrives.
    return new Promise((resolve) => {
      setImmediate(resolve);
    });
  }

  readAccountEvent(): AccountEvent {
    throw new Error("The webhook controller's to call, not the service's");
  }
}

class FakePayoutJobs implements PublicOf<PayoutJobs> {
  readonly scheduled: { bookingId: string; runAt: Date }[] = [];
  readonly hosts: string[] = [];

  schedulePayoutsOf(hostId: string): Promise<void> {
    this.hosts.push(hostId);

    return Promise.resolve();
  }

  schedulePayout(bookingId: string, runAt: Date): Promise<void> {
    this.scheduled.push({ bookingId, runAt });

    return Promise.resolve();
  }
}

class FakeNotificationService implements Pick<
  NotificationService,
  "notify" | "notifyAdmins"
> {
  readonly notices: { userId: string; content: NotificationContent }[] = [];
  readonly toAdmins: NotificationContent[] = [];

  notify(userId: string, content: NotificationContent): Promise<void> {
    this.notices.push({ userId, content });

    return Promise.resolve();
  }

  notifyAdmins(content: NotificationContent): Promise<void> {
    this.toAdmins.push(content);

    return Promise.resolve();
  }
}

describe("PayoutService", () => {
  let service: PayoutService;
  let payoutRepository: FakePayoutRepository;
  let payoutGateway: FakePayoutGateway;
  let payoutJobs: FakePayoutJobs;
  let notificationService: FakeNotificationService;

  /** A stay `GUEST_ID` paid for at a listing `HOST_ID` owns, checking in on `from`. */
  const paidStay = (
    from: string,
    overrides: Partial<StoredStay> = {},
  ): void => {
    payoutRepository.stays.set(BOOKING_ID, {
      bookingId: BOOKING_ID,
      status: BookingStatus.CONFIRMED,
      amount: AMOUNT,
      refundedAmount: null,
      refundOwed: null,
      paid: true,
      disputeStatus: null,
      chargeId: CHARGE_ID,
      transferId: null,
      paidOutAmount: null,
      paymentId: PAYMENT_ID,
      hold: {
        stay: {
          bookingId: BOOKING_ID,
          listingId: LISTING_ID,
          listingTitle: "Loft above the harbour",
          from,
          to: "2099-12-31",
        },
        guestId: GUEST_ID,
        listingOwnerId: HOST_ID,
        paymentId: PAYMENT_ID,
      },
      ...overrides,
    });
  };

  const hostWith = (accountId: string | null, enabled: boolean): void => {
    payoutRepository.holders.set(HOST_ID, {
      email: host.email,
      name: "Harbour Host",
      accountId,
      enabled,
    });
  };

  const stored = (): StoredStay | undefined =>
    payoutRepository.stays.get(BOOKING_ID);

  const noticesOf = (type: NotificationType) =>
    notificationService.notices.filter(({ content }) => content.type === type);

  beforeEach(async () => {
    payoutRepository = new FakePayoutRepository();
    payoutGateway = new FakePayoutGateway();
    payoutJobs = new FakePayoutJobs();
    notificationService = new FakeNotificationService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PayoutService,
        { provide: PayoutRepository, useValue: payoutRepository },
        { provide: PayoutGateway, useValue: payoutGateway },
        { provide: PayoutJobs, useValue: payoutJobs },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = moduleRef.get(PayoutService);
  });

  describe("the payout account", () => {
    it("answers NOT_STARTED to a host with no account, and opens none", async () => {
      hostWith(null, false);

      await expect(service.account(host)).resolves.toEqual({
        status: HostAccountStatus.NOT_STARTED,
      });
      expect(payoutGateway.accounts).toEqual([]);
    });

    it("opens the account on the first session and keeps it for the next", async () => {
      hostWith(null, false);

      await expect(service.session(host)).resolves.toEqual({
        clientSecret: `${ACCOUNT_ID}_session`,
      });
      await service.session(host);

      expect(payoutGateway.accounts).toEqual([
        { userId: HOST_ID, email: host.email, name: "Harbour Host" },
      ]);
      expect(payoutRepository.holders.get(HOST_ID)?.accountId).toBe(ACCOUNT_ID);
    });

    it("answers 502 for the provider's failure and leaves the database's its own", async () => {
      hostWith(null, false);
      payoutGateway.refusingSessions = true;

      await expect(service.session(host)).rejects.toBeInstanceOf(
        BadGatewayException,
      );

      payoutGateway.refusingSessions = false;
      hostWith(null, false);
      payoutRepository.brokenAttach = true;

      const failure = service.session(host);

      await expect(failure).rejects.toThrow("connection refused");
      await expect(failure).rejects.not.toBeInstanceOf(BadGatewayException);
    });

    it("reads the account off the row without asking Stripe", async () => {
      // Stripe would say yes; the row has not heard it yet, and a read does not ask.
      payoutGateway.enabled = true;
      hostWith(ACCOUNT_ID, false);

      await expect(service.account(host)).resolves.toEqual({
        status: HostAccountStatus.ONBOARDING,
      });
      expect(payoutRepository.holders.get(HOST_ID)?.enabled).toBe(false);
      expect(payoutJobs.hosts).toEqual([]);
    });

    it("asks Stripe about an unfinished account on a refresh, and queues what waited once it is done", async () => {
      payoutGateway.enabled = false;
      hostWith(ACCOUNT_ID, false);
      paidStay(PAST);

      await expect(service.refresh(host)).resolves.toEqual({
        status: HostAccountStatus.ONBOARDING,
      });
      expect(payoutJobs.hosts).toEqual([]);

      payoutGateway.enabled = true;

      await expect(service.refresh(host)).resolves.toEqual({
        status: HostAccountStatus.ENABLED,
      });
      await expect(service.account(host)).resolves.toEqual({
        status: HostAccountStatus.ENABLED,
      });
      // Nothing is sent inside the request the dashboard waits on; the job pays it.
      expect(payoutGateway.transfers.size).toBe(0);
      expect(payoutJobs.hosts).toEqual([HOST_ID]);

      await service.payDuePayouts(HOST_ID);

      expect(stored()?.paidOutAmount).toBe(SHARE);
    });
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
        paidOutAmount: SHARE,
      });
      const sent = noticesOf(NotificationType.PAYOUT_SENT);

      expect(sent.map(({ userId }) => userId)).toEqual([HOST_ID]);
      expect(sent[0]?.content.data).toMatchObject({ amount: SHARE });
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
      await service.handleAccountEvent({
        kind: "account",
        eventId: "evt_account",
        type: "v2.core.account[configuration.recipient].capability_status_updated",
        accountId: ACCOUNT_ID,
      });

      expect(payoutJobs.hosts).toEqual([HOST_ID]);

      await service.payDuePayouts(HOST_ID);

      expect(stored()?.paidOutAmount).toBe(SHARE);
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
      await service.handleAccountEvent({
        kind: "account",
        eventId: "evt_account_back",
        type: "v2.core.account[configuration.recipient].capability_status_updated",
        accountId: ACCOUNT_ID,
      });
      await service.payDuePayouts(HOST_ID);

      expect(stored()?.paidOutAmount).toBe(SHARE);
    });

    it("asks Stripe about a host's account once per run, however many stays it pays", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      const first = stored();

      if (first !== undefined) {
        payoutRepository.stays.set("second", { ...first, bookingId: "second" });
      }

      await expect(service.payDuePayouts()).resolves.toBe(2);

      expect(payoutGateway.asked).toBe(1);
    });

    it("pays nothing out of a refund a cancellation still owes the guest", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST, { status: BookingStatus.CANCELLED, refundOwed: AMOUNT });

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(false);

      expect(payoutGateway.transfers.size).toBe(0);
    });

    it("records the transfer an earlier run sent and never recorded, and takes back the difference", async () => {
      hostWith(ACCOUNT_ID, true);
      // The first attempt sent the full share and died before writing it down; a refund of
      // 80 landed since, so the host is owed 360 now and the retry asks for less.
      paidStay(PAST, { refundedAmount: 80 });
      payoutGateway.transfers.set(`booking-${BOOKING_ID}-payout`, {
        bookingId: BOOKING_ID,
        accountId: ACCOUNT_ID,
        chargeId: CHARGE_ID,
        amount: SHARE,
        description: "sent earlier",
        id: "tr_earlier",
      });

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);

      expect(payoutGateway.transfers.size).toBe(1);
      expect(stored()?.transferId).toBe("tr_earlier");
      expect([...payoutGateway.reversals.values()]).toEqual([
        { transferId: "tr_earlier", amount: 72 },
      ]);
      expect(stored()?.paidOutAmount).toBe(360);
      expect(noticesOf(NotificationType.PAYOUT_SENT)).toMatchObject([
        { content: { data: { amount: 360 } } },
      ]);
    });

    it("pays a guest's late cancellation that refunded nothing", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST, { status: BookingStatus.CANCELLED });

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(true);
      expect(stored()?.paidOutAmount).toBe(SHARE);
    });

    it("leaves a stay refunded in full out of the sweep for good", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST, {
        status: BookingStatus.CANCELLED,
        refundedAmount: AMOUNT,
      });

      await expect(service.payDuePayouts()).resolves.toBe(0);
      expect(payoutGateway.asked).toBe(0);
    });

    it("pays nothing for a stay refunded in full", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST, {
        status: BookingStatus.CANCELLED,
        refundedAmount: AMOUNT,
      });

      await expect(service.payOut(BOOKING_ID)).resolves.toBe(false);
      expect(payoutGateway.transfers.size).toBe(0);
    });

    it("takes back what a refund landing mid-transfer no longer leaves the host", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      payoutRepository.racing = () => {
        const stay = stored();

        if (stay !== undefined) stay.refundedAmount = 80;
      };

      await service.payOut(BOOKING_ID);

      // 90% of the 400 left is 360, so 72 of the 432 sent goes back.
      expect([...payoutGateway.reversals.values()]).toEqual([
        { transferId: "tr_1", amount: 72 },
      ]);
      expect(stored()?.paidOutAmount).toBe(360);
    });

    it("tells the host of a payout whose settlement failed, and settles it on the retry", async () => {
      hostWith(ACCOUNT_ID, true);
      paidStay(PAST);
      payoutRepository.racing = () => {
        const stay = stored();

        if (stay !== undefined) stay.refundedAmount = 80;
      };
      payoutGateway.failingReversals = 1;

      await expect(service.payOut(BOOKING_ID)).rejects.toThrow(
        "Stripe could not be reached",
      );

      expect(noticesOf(NotificationType.PAYOUT_SENT)).toMatchObject([
        { content: { data: { amount: SHARE } } },
      ]);
      expect(stored()?.paidOutAmount).toBe(SHARE);

      // The job comes again: nothing is sent twice, and the reversal goes out.
      await expect(service.payOut(BOOKING_ID)).resolves.toBe(false);

      expect(payoutGateway.transfers.size).toBe(1);
      expect(stored()?.paidOutAmount).toBe(360);
      expect(noticesOf(NotificationType.PAYOUT_SENT)).toHaveLength(1);
    });
  });

  describe("a refund the booking side recorded", () => {
    it("takes the host's share back after a payout, once", async () => {
      payoutGateway.sent("tr_1", SHARE);
      paidStay(PAST, {
        transferId: "tr_1",
        paidOutAmount: SHARE,
        refundedAmount: AMOUNT,
      });

      await service.settle(BOOKING_ID);
      await service.settle(BOOKING_ID);

      expect([...payoutGateway.reversals.entries()]).toEqual([
        [
          `booking-${BOOKING_ID}-reversal-43200-0`,
          { transferId: "tr_1", amount: SHARE },
        ],
      ]);
      expect(stored()?.paidOutAmount).toBe(0);
    });

    it("takes back the difference once when two settlements race over one stay", async () => {
      payoutGateway.sent("tr_1", SHARE);
      paidStay(PAST, {
        transferId: "tr_1",
        paidOutAmount: SHARE,
        refundedAmount: AMOUNT,
      });

      await Promise.all([
        service.settle(BOOKING_ID),
        service.settle(BOOKING_ID),
      ]);

      const reversed = [...payoutGateway.reversals.values()].reduce(
        (sum, { amount }) => sum + amount,
        0,
      );

      expect(reversed).toBe(SHARE);
      expect(stored()?.paidOutAmount).toBe(0);
    });

    it("answers what the host is left holding", async () => {
      payoutGateway.sent("tr_1", SHARE);
      paidStay(PAST, {
        transferId: "tr_1",
        paidOutAmount: SHARE,
        refundedAmount: 80,
      });

      // 90% of the 400 left.
      await expect(service.settle(BOOKING_ID)).resolves.toBe(360);
    });

    it("sizes a reversal from what Stripe holds, so one whose write was lost is not sent twice", async () => {
      payoutGateway.sent("tr_1", SHARE);
      // A first refund of 80 took 72 back at Stripe, and the run died before writing it
      // down: the row still says the whole share.
      payoutGateway.reversals.set("lost", { transferId: "tr_1", amount: 72 });
      paidStay(PAST, {
        transferId: "tr_1",
        paidOutAmount: SHARE,
        refundedAmount: 180,
      });

      // 90% of the 300 left is 270: only the 90 between it and the 360 still held goes back.
      await expect(service.settle(BOOKING_ID)).resolves.toBe(270);
      expect(
        payoutGateway.reversals.get(
          `booking-${BOOKING_ID}-reversal-36000-27000`,
        ),
      ).toEqual({ transferId: "tr_1", amount: 90 });
      expect(stored()?.paidOutAmount).toBe(270);
    });

    it("only writes down a reversal Stripe already holds", async () => {
      payoutGateway.sent("tr_1", SHARE);
      payoutGateway.reversals.set("lost", { transferId: "tr_1", amount: 72 });
      paidStay(PAST, {
        transferId: "tr_1",
        paidOutAmount: SHARE,
        refundedAmount: 80,
      });

      await expect(service.settle(BOOKING_ID)).resolves.toBe(360);
      expect(payoutGateway.reversals.size).toBe(1);
      expect(stored()?.paidOutAmount).toBe(360);
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

    it("leaves a payout already sent alone while the dispute is open", async () => {
      payoutGateway.sent("tr_1", SHARE);
      paidStay(PAST, { transferId: "tr_1", paidOutAmount: SHARE });

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
        paidOutAmount: SHARE,
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
        paidOutAmount: SHARE,
      });
      expect(noticesOf(NotificationType.PAYMENT_DISPUTED)).toEqual([]);
    });

    it("takes the whole payout back once a dispute is lost", async () => {
      payoutGateway.sent("tr_1", SHARE);
      paidStay(PAST, { transferId: "tr_1", paidOutAmount: SHARE });

      await service.handleSettlementEvent(disputed);
      await service.handleSettlementEvent(closed(false));

      expect([...payoutGateway.reversals.values()]).toEqual([
        { transferId: "tr_1", amount: SHARE },
      ]);
      expect(stored()).toMatchObject({
        disputeStatus: "LOST",
        paidOutAmount: 0,
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
