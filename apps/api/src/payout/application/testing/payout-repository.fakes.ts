import { payoutDueAt, type DisputeStatus } from "@repo/contracts";
import type { SetAside } from "../../../common/job-failure";
import type { PublicOf } from "../../../common/testing/public-of.fakes";
import {
  addCents,
  cents,
  NO_CENTS,
  subtractCents,
  type Cents,
} from "../../../payment/domain/money";
import { SettlementInProgressError } from "../../domain/payout.errors";
import type {
  Holding,
  PayoutAccountHolder,
  PayoutReservation,
  RecordedPayout,
  SettledStay,
  SettlementWrites,
} from "../../domain/payout.types";
import type { PayoutRepository } from "../../infrastructure/payout.repository";
import type { StoredFee, StoredStay } from "./payout-fixtures.fakes";

/**
 * The stays and the payout accounts in memory. What the service decides — whether a payout
 * may go, how much, and what to take back — is asserted against what ends up stored here,
 * and the SQL behind each write is the e2e specs'. The conditional writes keep the shape of
 * the real ones: a transfer only into an empty column, a reversal only from the amount the
 * caller read, a refund total only upwards.
 */
export class FakePayoutRepository implements PublicOf<PayoutRepository> {
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
            payoutDueAt(stay.hold.checkIn) <= now &&
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
