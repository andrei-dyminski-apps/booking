import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  BookingStatus,
  hostShare,
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
import {
  addCents,
  cents,
  CURRENCY,
  NO_CENTS,
  subtractCents,
  type Cents,
} from "../../payment/domain/money";
import { SettlementInProgressError } from "../domain/payout.errors";
import type {
  Holding,
  PayoutAccountHolder,
  PayoutReservation,
  RecordedPayout,
  SettledStay,
  SettlementWrites,
} from "../domain/payout.types";
import { PayoutRepository } from "../infrastructure/payout.repository";
import {
  MAX_PAYOUT_ATTEMPTS,
  PayoutService,
  type SettlementEvent,
} from "./payout.service";
import {
  PayoutGateway,
  type AccountEvent,
  type Caller,
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

/**
 * What the stay cost, and the host's share of it — read off the contract's own rule rather
 * than restated: the rate and the rounding are `hostShare`'s, pinned by its own spec, and
 * what this file checks is what the service does with the share.
 */
const AMOUNT = cents(48_000);
const SHARE = hostShare(AMOUNT, NO_CENTS);
/** 80 of the stay refunded and 180, and the host's share once each has been. */
const REFUNDED_80 = cents(8_000);
const REFUNDED_180 = cents(18_000);
const SHARE_AFTER_80 = hostShare(AMOUNT, REFUNDED_80);
const SHARE_AFTER_180 = hostShare(AMOUNT, REFUNDED_180);

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

/**
 * The destination is read off the host whenever the stay is, as the real join does, and
 * whether it was paid out off the amount the payout wrote — the real `paid_out_at` is
 * written in the same statement.
 */
type StoredStay = Omit<SettledStay, "destination" | "paidOut"> & {
  paymentId: string;
};

/** A host's fee as the ledger holds it, oldest first in `fees`. */
type StoredFee = {
  id: string;
  hostId: string;
  amountCents: Cents;
  withheldCents: Cents;
  waived: boolean;
};

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
  /** Oldest first, the order a payout withholds them in. */
  readonly fees: StoredFee[] = [];

  /** What each stay's payout kept back towards each fee, as `host_fee_withholdings`. */
  readonly withholdings = new Map<string, Map<string, number>>();

  /** Run just before a payout is recorded, as a refund racing the transfer would. */
  racing: (() => void) | null = null;

  /** Run as the transfer's lease is taken, as a refund landing after the reservation would. */
  beforePayingOut: (() => void) | null = null;

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
  ): Promise<{ userId: string; switched: boolean } | null> {
    const found = [...this.holders.entries()].find(
      ([, holder]) => holder.accountId === accountId,
    );

    if (found === undefined) return Promise.resolve(null);

    const [userId, holder] = found;
    const switched = enabled !== holder.enabled;

    holder.enabled = enabled;

    return Promise.resolve({ userId, switched });
  }

  findStay(bookingId: string): Promise<SettledStay | null> {
    const stay = this.stays.get(bookingId);

    return Promise.resolve(stay === undefined ? null : this.settledOf(stay));
  }

  exists(bookingId: string): Promise<boolean> {
    return Promise.resolve(this.stays.has(bookingId));
  }

  /**
   * The lease of the real repository, shared by a settlement and a transfer: one of them per
   * booking at a time, in arrival order.
   */
  private readonly settling = new Map<string, Promise<unknown>>();

  /** Set to have every lease found held past its wait, as another run holding it would. */
  leaseTaken = false;

  private leased<T>(bookingId: string, work: () => Promise<T>): Promise<T> {
    if (this.leaseTaken) {
      return Promise.reject(new SettlementInProgressError(bookingId));
    }

    const previous = this.settling.get(bookingId) ?? Promise.resolve();
    const run = previous.then(work);

    this.settling.set(
      bookingId,
      run.catch(() => undefined),
    );

    return run;
  }

  async whileSettling<T>(
    bookingId: string,
    work: (stay: SettledStay | null, writes: SettlementWrites) => Promise<T>,
  ): Promise<T> {
    return this.leased(bookingId, async () =>
      work(await this.findStay(bookingId), {
        settlement: (from, to) => this.recordSettlement(bookingId, from, to),
        payout: (payout) =>
          Promise.resolve(this.recordPayout(bookingId, payout)),
        release: (reservation) =>
          Promise.resolve(this.release(bookingId, reservation)),
      }),
    );
  }

  async whilePayingOut<T>(
    bookingId: string,
    work: (
      stay: SettledStay | null,
      record: (payout: RecordedPayout) => Promise<boolean>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.leased(bookingId, async () => {
      this.beforePayingOut?.();

      return work(await this.findStay(bookingId), (payout) =>
        Promise.resolve(this.recordPayout(bookingId, payout)),
      );
    });
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
      paidOut: stay.paidOutAmountCents !== null,
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

    if (
      stay === undefined ||
      stay.paidOutAmountCents !== null ||
      failure.setAside
    ) {
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
            stay.paidOutAmountCents === null &&
            this.payoutFailures.get(stay.bookingId)?.setAside !== true &&
            stay.refundOwedCents === null &&
            payoutDueAt(stay.hold.stay.from) <= now &&
            (stay.disputeStatus === null || stay.disputeStatus === "WON") &&
            (stay.refundedAmountCents === null ||
              stay.refundedAmountCents < stay.amountCents) &&
            (this.holders.get(stay.hold.listingOwnerId)?.enabled === true ||
              stay.payoutReservedCents !== null) &&
            (hostId === undefined || stay.hold.listingOwnerId === hostId),
        )
        .map((stay) => stay.bookingId)
        .sort((left, right) => attemptsOf(left) - attemptsOf(right))
        .slice(0, limit),
    );
  }

  /** The host's lock of the real repository: one reservation of a host at a time. */
  private readonly reservingFor = new Map<string, Promise<unknown>>();

  /** How many reservations were written, a reservation answered again not counted. */
  reservations = 0;

  async reservePayout(
    bookingId: string,
    hostId: string,
    split: (owedFees: Cents) => PayoutReservation,
  ): Promise<boolean> {
    const previous = this.reservingFor.get(hostId) ?? Promise.resolve();
    const run = previous.then(() => this.reserve(bookingId, hostId, split));

    this.reservingFor.set(
      hostId,
      run.catch(() => undefined),
    );

    return run;
  }

  private reserve(
    bookingId: string,
    hostId: string,
    split: (owedFees: Cents) => PayoutReservation,
  ): boolean {
    const stay = this.stays.get(bookingId);

    if (stay === undefined || stay.paidOutAmountCents !== null) return false;

    if (stay.payoutReservedCents !== null) return true;

    const reservation = split(this.owedFeesOf(hostId));

    stay.payoutReservedCents = reservation.send;
    stay.feeWithheldCents = reservation.withheld;
    stay.payoutReservations += 1;
    this.reservations += 1;

    let left: number = reservation.withheld;

    for (const fee of this.fees) {
      if (fee.hostId !== hostId || fee.waived) continue;

      const taken = Math.min(left, fee.amountCents - fee.withheldCents);

      if (taken === 0) continue;

      fee.withheldCents = addCents(fee.withheldCents, cents(taken));
      this.withhold(bookingId, fee.id, taken);
      left -= taken;
    }

    return true;
  }

  /** Records that the stay's payout kept `amount` back towards the fee. */
  withhold(bookingId: string, feeId: string, amount: number): void {
    const ofStay =
      this.withholdings.get(bookingId) ?? new Map<string, number>();

    ofStay.set(feeId, (ofStay.get(feeId) ?? 0) + amount);
    this.withholdings.set(bookingId, ofStay);
  }

  owedFeesOf(hostId: string): Cents {
    return cents(
      this.fees
        .filter((fee) => fee.hostId === hostId && !fee.waived)
        .reduce((sum, fee) => sum + fee.amountCents - fee.withheldCents, 0),
    );
  }

  private recordPayout(bookingId: string, payout: RecordedPayout): boolean {
    this.racing?.();

    const stay = this.stays.get(bookingId);

    if (
      stay === undefined ||
      stay.paidOutAmountCents !== null ||
      stay.payoutReservedCents === null
    ) {
      return false;
    }

    stay.transferId = payout.transferId;
    stay.paidOutAmountCents = payout.sent;
    stay.payoutReservedCents = null;

    // A payout recorded is not stuck; the attempts stay as its history.
    const failure = this.payoutFailures.get(bookingId);

    if (failure !== undefined) failure.setAside = false;

    return true;
  }

  private release(bookingId: string, reservation: PayoutReservation): boolean {
    const stay = this.stays.get(bookingId);

    if (
      stay === undefined ||
      stay.paidOutAmountCents !== null ||
      stay.payoutReservedCents !== reservation.send ||
      stay.feeWithheldCents !== reservation.withheld
    ) {
      return false;
    }

    stay.payoutReservedCents = null;
    stay.feeWithheldCents = NO_CENTS;
    this.handBack(bookingId, reservation.withheld);

    return true;
  }

  /**
   * Onto the fees the stay's payout kept the money back for, as the real repository hands it
   * back: a fee still owed first, newest first, a waived one last.
   */
  private handBack(bookingId: string, amount: number): void {
    const ofStay =
      this.withholdings.get(bookingId) ?? new Map<string, number>();
    const fees = [...this.fees].reverse().filter((fee) => ofStay.has(fee.id));
    let back = amount;

    for (const fee of [
      ...fees.filter(({ waived }) => !waived),
      ...fees.filter(({ waived }) => waived),
    ]) {
      const returned = Math.min(back, ofStay.get(fee.id) ?? 0);

      fee.withheldCents = subtractCents(fee.withheldCents, cents(returned));
      ofStay.set(fee.id, (ofStay.get(fee.id) ?? 0) - returned);

      if (ofStay.get(fee.id) === 0) ofStay.delete(fee.id);

      back -= returned;
    }
  }

  recordSettlement(
    bookingId: string,
    from: Holding,
    to: Holding,
  ): Promise<boolean> {
    const stay = this.stays.get(bookingId);

    if (
      stay === undefined ||
      stay.paidOutAmountCents !== from.paidOut ||
      stay.feeWithheldCents !== from.withheld
    ) {
      return Promise.resolve(false);
    }

    stay.paidOutAmountCents = to.paidOut;
    stay.feeWithheldCents = to.withheld;
    this.handBack(bookingId, from.withheld - to.withheld);

    return Promise.resolve(true);
  }

  /**
   * The list's cut too: a dispute lost or a stay refunded in full owes the host nothing,
   * and an open dispute holds the payout.
   */
  handBackPayout(bookingId: string): Promise<boolean> {
    const stay = this.stays.get(bookingId);

    if (
      stay === undefined ||
      !stay.paid ||
      stay.paidOutAmountCents !== null ||
      (stay.disputeStatus !== null && stay.disputeStatus !== "WON") ||
      (stay.refundedAmountCents ?? 0) >= stay.amountCents ||
      this.payoutFailures.get(bookingId)?.setAside !== true
    ) {
      return Promise.resolve(false);
    }

    this.payoutFailures.delete(bookingId);

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
  readonly reversals = new Map<string, { transferId: string; amount: Cents }>();

  /**
   * What `transfersEnabled` answers for any account. On by default: a spec about a host
   * Stripe says cannot be paid turns it off, the way a lapsed capability would.
   */
  enabled = true;

  /** Each time Stripe was asked about an account, by who waits on the answer. */
  readonly askedBy: Caller[] = [];

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

  transfersEnabled(_accountId: string, caller: Caller): Promise<boolean> {
    this.askedBy.push(caller);

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

  /** How many times Stripe was asked for a transfer by its group. */
  lookups = 0;

  findTransfer(bookingId: string): Promise<SentTransfer | null> {
    this.lookups += 1;

    const sent = this.transfers.get(`booking-${bookingId}-payout`);

    return Promise.resolve(
      sent === undefined ? null : { id: sent.id, amount: sent.amount },
    );
  }

  /** A transfer an earlier run sent, as Stripe would hold it. */
  sent(id: string, amount: Cents): void {
    this.transfers.set(`booking-${BOOKING_ID}-payout`, {
      bookingId: BOOKING_ID,
      accountId: ACCOUNT_ID,
      chargeId: CHARGE_ID,
      amount,
      reservation: 1,
      currency: CURRENCY,
      description: "sent earlier",
      id,
    });
  }

  /** What was sent less every reversal of it, the way Stripe reads `amount_reversed`. */
  heldOnTransfer(transferId: string): Promise<Cents> {
    const transfer = [...this.transfers.values()].find(
      ({ id }) => id === transferId,
    );

    if (transfer === undefined) {
      return Promise.reject(new Error(`No such transfer: ${transferId}`));
    }

    const reversed = [...this.reversals.values()]
      .filter((reversal) => reversal.transferId === transferId)
      .reduce((sum, { amount }) => addCents(sum, amount), NO_CENTS);

    return Promise.resolve(subtractCents(transfer.amount, reversed));
  }

  reverseTransfer(
    transferId: string,
    amount: Cents,
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
      amountCents: AMOUNT,
      currency: CURRENCY,
      refundedAmountCents: null,
      refundOwedCents: null,
      paid: true,
      disputeStatus: null,
      chargeId: CHARGE_ID,
      transferId: null,
      paidOutAmountCents: null,
      payoutReservedCents: null,
      payoutReservations: 0,
      feeWithheldCents: NO_CENTS,
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
      expect(payoutGateway.askedBy).toEqual(["request", "request"]);

      await service.payDuePayouts(HOST_ID);

      expect(stored()?.paidOutAmountCents).toBe(SHARE);
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
      await service.handleAccountEvent({
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
      await service.handleAccountEvent({
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
      await service.handleAccountEvent({
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
