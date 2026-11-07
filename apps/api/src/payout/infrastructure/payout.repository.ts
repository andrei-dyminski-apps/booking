import { Injectable } from "@nestjs/common";
import { DisputeStatus, PAYOUT_DELAY_HOURS } from "@repo/contracts";
import { subHours } from "date-fns";
import type { Prisma } from "../../generated/prisma/client";
import {
  LeaseBusyError,
  whileLeased,
  type LeaseTiming,
} from "../../booking/infrastructure/booking-lease";
import {
  bookingExists,
  owedFeesWhere,
  payoutOwed,
  stuckPayout,
} from "../../booking/infrastructure/booking-where";
import {
  nullableCentsOf,
  RELEASED_HOLD_INCLUDE,
  toRefundTarget,
} from "../../booking/infrastructure/stay-rows";
import type { SetAside } from "../../common/job-failure";
import {
  addCents,
  cents,
  minCents,
  NO_CENTS,
  subtractCents,
  type Cents,
} from "../../payment/domain/money";
import { PrismaService } from "../../prisma/prisma.service";
import { SettlementInProgressError } from "../domain/payout.errors";
import type {
  Holding,
  PayoutAccountHolder,
  PayoutReservation,
  RecordedPayout,
  SettledStay,
  SettlementWrites,
} from "../domain/payout.types";

const SETTLED_STAY_INCLUDE = {
  listing: {
    select: {
      ...RELEASED_HOLD_INCLUDE.listing.select,
      owner: { select: { stripeAccountId: true, payoutsEnabledAt: true } },
    },
  },
} satisfies Prisma.BookingInclude;

/**
 * A stay's money after its payment, and the payout account on a user — apart from
 * `BookingRepository` because none of it is about the slot.
 */
@Injectable()
export class PayoutRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /** `null` for a user who is gone — the token outlived the row. */
  async findHolder(userId: string): Promise<PayoutAccountHolder | null> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        name: true,
        stripeAccountId: true,
        payoutsEnabledAt: true,
      },
    });

    return user === null
      ? null
      : {
          email: user.email,
          name: user.name,
          accountId: user.stripeAccountId,
          enabled: user.payoutsEnabledAt !== null,
        };
  }

  async attachAccount(userId: string, accountId: string): Promise<void> {
    await this.prismaService.user.updateMany({
      where: { id: userId, stripeAccountId: null },
      data: { stripeAccountId: accountId },
    });
  }

  /**
   * `null` for an account this API never opened. `switched` only for the write that changed
   * the flag, so of two runs with the same news one acts on it.
   */
  async setPayoutsEnabled(
    accountId: string,
    enabled: boolean,
  ): Promise<{ userId: string; switched: boolean } | null> {
    const user = await this.prismaService.user.findUnique({
      where: { stripeAccountId: accountId },
      select: { id: true },
    });

    if (user === null) return null;

    const { count } = await this.prismaService.user.updateMany({
      where: enabled
        ? { id: user.id, payoutsEnabledAt: null }
        : { id: user.id, payoutsEnabledAt: { not: null } },
      data: { payoutsEnabledAt: enabled ? new Date() : null },
    });

    return { userId: user.id, switched: count > 0 };
  }

  async findStay(bookingId: string): Promise<SettledStay | null> {
    return readStay(this.prismaService, bookingId);
  }

  /**
   * The stay read under the settlement lease: without it two runs sized from the same
   * `paid_out_amount_cents` reverse the same money under two different keys. A lease held past
   * the wait is `SettlementInProgressError`, the way `whileCancelling` answers its own.
   * The writes take the host's lock off the stay as read — a listing never changes hands —
   * so they can take it before the row's, the order `reservePayout` takes the two in.
   */
  async whileSettling<T>(
    bookingId: string,
    work: (stay: SettledStay | null, writes: SettlementWrites) => Promise<T>,
  ): Promise<T> {
    return this.leased(bookingId, async () => {
      const stay = await readStay(this.prismaService, bookingId);
      const hostId = stay?.hold.listingOwnerId ?? null;

      return work(stay, {
        settlement: (from, to) =>
          hostId === null
            ? Promise.resolve(false)
            : this.writeSettlement(bookingId, hostId, from, to),
        payout: (payout) => writePayout(this.prismaService, bookingId, payout),
        release: (reservation) =>
          hostId === null
            ? Promise.resolve(false)
            : this.releaseReservation(bookingId, hostId, reservation),
      });
    });
  }

  /**
   * The transfer of a reserved payout, under the same lease as a settlement: one never runs
   * while the other is between Stripe and its write, so a settlement that finds no transfer
   * for a reservation knows none is on its way. A lease rather than a transaction, so no
   * connection waits on Stripe.
   */
  async whilePayingOut<T>(
    bookingId: string,
    work: (
      stay: SettledStay | null,
      record: (payout: RecordedPayout) => Promise<boolean>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.leased(bookingId, async () =>
      work(await readStay(this.prismaService, bookingId), (payout) =>
        writePayout(this.prismaService, bookingId, payout),
      ),
    );
  }

  private async leased<T>(
    bookingId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await whileLeased(
        this.prismaService,
        "settling_until",
        bookingId,
        SETTLE_LEASE,
        work,
      );
    } catch (error) {
      if (error instanceof LeaseBusyError) {
        throw new SettlementInProgressError(bookingId);
      }

      throw error;
    }
  }

  async findStayByPayment(paymentId: string): Promise<SettledStay | null> {
    const row = await this.prismaService.booking.findUnique({
      where: { paymentIntentId: paymentId },
      include: SETTLED_STAY_INCLUDE,
    });

    return row === null ? null : toSettledStay(row);
  }

  /**
   * A coarse cut over the partial index; what is owed is the service's rule. A stay refunded
   * in full is left out, or every sweep would read it again for good. A host who cannot be
   * paid is left out too, except for a stay with a reservation standing: its run is what
   * hands the reservation back, whichever way the account was switched off.
   */
  async findDuePayouts(
    now: Date,
    limit: number,
    hostId?: string,
  ): Promise<string[]> {
    const where: Prisma.BookingWhereInput = {
      AND: [
        payoutOwed(this.prismaService.booking.fields),
        {
          OR: [
            { listing: { owner: { payoutsEnabledAt: { not: null } } } },
            { payoutReservedCents: { not: null } },
          ],
        },
      ],
      payoutFailedAt: null,
      // `from` is a `@db.Date`, compared as a day.
      from: { lte: subHours(now, PAYOUT_DELAY_HOURS) },
      ...(hostId === undefined ? {} : { listing: { ownerId: hostId } }),
    };

    const rows = await this.prismaService.booking.findMany({
      where,
      select: { id: true },
      // The fewest failures first, so stays that keep failing cannot fill every batch.
      orderBy: [{ payoutAttempts: "asc" }, { from: "asc" }],
      take: limit,
    });

    return rows.map(({ id }) => id);
  }

  /** `recordRefundFailure`'s two steps. `null` for a stay paid out or set aside already. */
  async recordPayoutFailure(
    bookingId: string,
    error: string,
    maxAttempts: number,
  ): Promise<SetAside | null> {
    const pending = {
      id: bookingId,
      paidOutAt: null,
      payoutFailedAt: null,
    } satisfies Prisma.BookingWhereInput;
    const [counted] = await this.prismaService.booking.updateManyAndReturn({
      where: pending,
      data: { payoutAttempts: { increment: 1 }, payoutLastError: error },
      select: { payoutAttempts: true },
    });

    if (counted === undefined) return null;

    if (counted.payoutAttempts < maxAttempts) {
      return { attempts: counted.payoutAttempts, setAside: false };
    }

    const { count } = await this.prismaService.booking.updateMany({
      where: pending,
      data: { payoutFailedAt: new Date() },
    });

    return { attempts: counted.payoutAttempts, setAside: count > 0 };
  }

  /**
   * Hands a set-aside payout back with a whole count of attempts. `false` for a stay whose
   * payout is not set aside — sent since, never stuck, or owing the host nothing any more,
   * which the list of stuck payouts leaves out too — or that is not there.
   */
  async handBackPayout(bookingId: string): Promise<boolean> {
    const { count } = await this.prismaService.booking.updateMany({
      where: {
        AND: [
          { id: bookingId },
          stuckPayout(this.prismaService.booking.fields),
        ],
      },
      data: { payoutFailedAt: null, payoutAttempts: 0 },
    });

    return count > 0;
  }

  async exists(bookingId: string): Promise<boolean> {
    return bookingExists(this.prismaService, bookingId);
  }

  /**
   * Fixes what a stay's payout sends and keeps back, under the host's lock and in a short
   * transaction: `split` is told what the host still owes in fees, and what it keeps back goes
   * onto those fees at once, oldest first, so two stays of one host reserved at once cannot
   * keep back the same debt. A reservation already there is left as it is — a retry sends
   * what the first run meant to. Whether a reservation stands now; `false` for a stay paid out
   * already, or gone. What it sends is read again under the transfer's lease, not from here.
   */
  async reservePayout(
    bookingId: string,
    hostId: string,
    split: (owedFees: Cents) => PayoutReservation,
  ): Promise<boolean> {
    return this.prismaService.$transaction(async (tx) => {
      await lockHostFees(tx, hostId);

      const row = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { paidOutAt: true, payoutReservedCents: true, currency: true },
      });

      if (row === null || row.paidOutAt !== null) return false;

      if (row.payoutReservedCents !== null) return true;

      // Only the fees in the stay's currency: a payout keeps back cents of what it sends.
      const fees = await owedFeesOf(tx, hostId, row.currency);
      const reservation = split(
        fees.reduce((sum, fee) => addCents(sum, fee.owed), NO_CENTS),
      );
      const { count } = await tx.booking.updateMany({
        where: { id: bookingId, paidOutAt: null, payoutReservedCents: null },
        data: {
          payoutReservedCents: reservation.send,
          feeWithheldCents: reservation.withheld,
          // A new reservation is a new request to Stripe: its number keys the transfer.
          payoutReservations: { increment: 1 },
        },
      });

      if (count === 0) return false;

      await takeFromFees(tx, bookingId, fees, reservation.withheld);

      return true;
    });
  }

  /**
   * A reservation handed back, written only over the one read; what it kept back goes back
   * onto the fees it was kept back for, under the host's lock — taken before the row is
   * written, as every transaction that holds both takes them.
   */
  private async releaseReservation(
    bookingId: string,
    hostId: string,
    reservation: PayoutReservation,
  ): Promise<boolean> {
    return this.prismaService.$transaction(async (tx) => {
      if (reservation.withheld > 0) await lockHostFees(tx, hostId);

      const { count } = await tx.booking.updateMany({
        where: {
          id: bookingId,
          paidOutAt: null,
          payoutReservedCents: reservation.send,
          feeWithheldCents: reservation.withheld,
        },
        data: { payoutReservedCents: null, feeWithheldCents: 0 },
      });

      if (count === 0) return false;

      if (reservation.withheld > 0) {
        await returnToFees(tx, bookingId, reservation.withheld);
      }

      return true;
    });
  }

  /**
   * What a settlement leaves the host holding, written only over what it read — even under
   * the lease, so a write by anything outside it reads as `false`. What it hands back of the
   * withheld goes back as debt onto the fees this stay's payout kept it back for, under the
   * host's lock — taken before the row is written, as every transaction that holds both
   * takes them.
   */
  private async writeSettlement(
    bookingId: string,
    hostId: string,
    from: Holding,
    to: Holding,
  ): Promise<boolean> {
    const handsBack = to.withheld < from.withheld;

    return this.prismaService.$transaction(async (tx) => {
      if (handsBack) await lockHostFees(tx, hostId);

      const { count } = await tx.booking.updateMany({
        where: {
          id: bookingId,
          paidOutAmountCents: from.paidOut,
          feeWithheldCents: from.withheld,
        },
        data: { paidOutAmountCents: to.paidOut, feeWithheldCents: to.withheld },
      });

      if (count === 0) return false;

      if (handsBack) {
        await returnToFees(
          tx,
          bookingId,
          subtractCents(from.withheld, to.withheld),
        );
      }

      return true;
    });
  }

  /** Forward only: Stripe does not order its events, and a late `created` must not reopen one. */
  async setDisputeStatus(
    bookingId: string,
    status: DisputeStatus,
  ): Promise<boolean> {
    const { count } = await this.prismaService.booking.updateMany({
      where: {
        id: bookingId,
        OR: [
          { disputeStatus: null },
          ...(status === DisputeStatus.OPEN
            ? []
            : [{ disputeStatus: DisputeStatus.OPEN }]),
        ],
      },
      data: { disputeStatus: status },
    });

    return count > 0;
  }
}

/** Room for one Stripe call; a run that waits longer gives up and its job or delivery comes again. */
const SETTLE_LEASE: LeaseTiming = {
  leaseMs: 30_000,
  waitMs: 10_000,
  pollMs: 100,
  pollMaxMs: 1_000,
};

async function readStay(
  client: Pick<Prisma.TransactionClient, "booking">,
  bookingId: string,
): Promise<SettledStay | null> {
  const row = await client.booking.findUnique({
    where: { id: bookingId },
    include: SETTLED_STAY_INCLUDE,
  });

  return row === null ? null : toSettledStay(row);
}

/**
 * One host's fees, one writer at a time: a reservation keeping some back, a settlement or a
 * released reservation handing some back, an admin's waiver. Taken in each transaction that
 * moves `withheld_cents` or changes which fees are owed, before it does — and before it
 * writes a `bookings` row, so the lock and the row lock are always taken in that order.
 */
export async function lockHostFees(
  tx: Prisma.TransactionClient,
  hostId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`host-fees:${hostId}`}, 0))`;
}

/** A fee the host still owes and how much of it, oldest first — the order a payout keeps back in. */
type OwedFee = { id: string; owed: Cents };

/**
 * The fees in `currency` the host still owes, read once under the host's lock, for the sum and
 * the withholding alike.
 */
async function owedFeesOf(
  tx: Prisma.TransactionClient,
  hostId: string,
  currency: string,
): Promise<OwedFee[]> {
  const fees = await tx.hostFee.findMany({
    where: { ...owedFeesWhere(tx, hostId), currency },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, amountCents: true, withheldCents: true },
  });

  return fees.map((fee) => ({
    id: fee.id,
    owed: subtractCents(cents(fee.amountCents), cents(fee.withheldCents)),
  }));
}

/**
 * Only into a reserved stay not paid out yet, so a payout is recorded once; the reservation
 * is spent with it. What was kept back went onto the fees with the reservation. A payout
 * recorded is not stuck: a stay set aside whose transfer a settlement found takes the mark
 * off with the record, and the attempts stay as its history.
 */
async function writePayout(
  client: Pick<Prisma.TransactionClient, "booking">,
  bookingId: string,
  payout: RecordedPayout,
): Promise<boolean> {
  const { count } = await client.booking.updateMany({
    where: {
      id: bookingId,
      paidOutAt: null,
      payoutReservedCents: { not: null },
    },
    data: {
      transferId: payout.transferId,
      paidOutAmountCents: payout.sent,
      payoutReservedCents: null,
      paidOutAt: new Date(),
      payoutFailedAt: null,
    },
  });

  return count > 0;
}

/**
 * What a reservation keeps back, onto the fees the host owes oldest first, and which fee each
 * part went to (`host_fee_withholdings`) — what a later hand-back reads. `fees` is what the
 * reservation was sized from, read under the same lock, so it covers what is kept back.
 */
async function takeFromFees(
  tx: Prisma.TransactionClient,
  bookingId: string,
  fees: OwedFee[],
  amount: Cents,
): Promise<void> {
  let left = amount;

  for (const fee of fees) {
    if (left === 0) break;

    const taken = minCents(left, fee.owed);

    await tx.hostFee.update({
      where: { id: fee.id },
      data: { withheldCents: { increment: taken } },
    });
    await tx.hostFeeWithholding.upsert({
      where: { bookingId_hostFeeId: { bookingId, hostFeeId: fee.id } },
      create: { bookingId, hostFeeId: fee.id, amountCents: taken },
      update: { amountCents: { increment: taken } },
    });
    left = subtractCents(left, taken);
  }
}

/**
 * Money a stay's payout kept back, handed back onto the fees it was kept back for — the debt
 * the host owes again. A fee still owed takes it first, newest first; a waived fee comes
 * last — it is owed no more, so what lands on it is forgiven with it. Nothing goes onto a fee
 * this stay never paid towards, so a waiver forgives what the screen showed it forgiving.
 * Called under the host's lock, which the fees' `withheld_cents` is written under.
 */
async function returnToFees(
  tx: Prisma.TransactionClient,
  bookingId: string,
  amount: Cents,
): Promise<void> {
  const withholdings = await tx.hostFeeWithholding.findMany({
    where: { bookingId },
    orderBy: [{ hostFee: { createdAt: "desc" } }, { hostFee: { id: "desc" } }],
    select: {
      hostFeeId: true,
      amountCents: true,
      hostFee: { select: { waivedAt: true } },
    },
  });
  let left = amount;

  for (const withholding of [
    ...withholdings.filter(({ hostFee }) => hostFee.waivedAt === null),
    ...withholdings.filter(({ hostFee }) => hostFee.waivedAt !== null),
  ]) {
    if (left === 0) break;

    const back = minCents(left, cents(withholding.amountCents));
    const key = {
      bookingId_hostFeeId: { bookingId, hostFeeId: withholding.hostFeeId },
    };

    await tx.hostFee.update({
      where: { id: withholding.hostFeeId },
      data: { withheldCents: { decrement: back } },
    });

    if (back === withholding.amountCents) {
      await tx.hostFeeWithholding.delete({ where: key });
    } else {
      await tx.hostFeeWithholding.update({
        where: key,
        data: { amountCents: { decrement: back } },
      });
    }

    left = subtractCents(left, back);
  }

  // The withholdings add up to the stay's `fee_withheld_cents`, which bounds what is handed
  // back, so nothing is left over. Were anything — a write around the API — it is nobody's
  // debt rather than a throw: a settlement gets here after its reversal went out, and a
  // throw would roll its record back on every retry.
}

type SettledStayRow = Prisma.BookingGetPayload<{
  include: typeof SETTLED_STAY_INCLUDE;
}>;

function toSettledStay(row: SettledStayRow): SettledStay {
  return {
    ...toRefundTarget(row),
    disputeStatus: row.disputeStatus,
    chargeId: row.chargeId,
    transferId: row.transferId,
    paidOut: row.paidOutAt !== null,
    paidOutAmountCents: nullableCentsOf(row.paidOutAmountCents),
    payoutReservedCents: nullableCentsOf(row.payoutReservedCents),
    payoutReservations: row.payoutReservations,
    feeWithheldCents: cents(row.feeWithheldCents),
    destination: {
      accountId: row.listing.owner.stripeAccountId,
      enabled: row.listing.owner.payoutsEnabledAt !== null,
    },
  };
}
