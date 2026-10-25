import { Injectable } from "@nestjs/common";
import { PAYOUT_DELAY_HOURS, type BookingStatus } from "@repo/contracts";
import { subHours } from "date-fns";
import { DisputeStatus, type Prisma } from "../../generated/prisma/client";
import {
  RELEASED_HOLD_INCLUDE,
  toRefundTarget,
  type ReleasedHold,
} from "../../booking/infrastructure/booking.repository";
import {
  whileLeased,
  type LeaseTiming,
} from "../../booking/infrastructure/booking-lease";
import { PrismaService } from "../../prisma/prisma.service";
import type { DisputeState, PayoutFacts } from "../domain/payout";

/** The host side of a payout: where it goes, and whether it can go there yet. */
export type PayoutDestination = {
  accountId: string | null;
  enabled: boolean;
};

/**
 * A stay as the money after its payment sees it: paid, refunded and transferred, the two
 * people a notice names, and where the host is paid — read through the listing.
 */
export type SettledStay = PayoutFacts & {
  bookingId: string;
  status: BookingStatus;
  chargeId: string | null;
  transferId: string | null;
  /** What the host holds of this stay now; `null` before a transfer. */
  paidOutAmount: number | null;
  hold: ReleasedHold;
  destination: PayoutDestination;
};

/** A user as their payout account is opened for them. */
export type PayoutAccountHolder = PayoutDestination & {
  email: string;
  name: string;
};

const SETTLED_STAY_INCLUDE = {
  listing: {
    select: {
      ...RELEASED_HOLD_INCLUDE.listing.select,
      owner: { select: { stripeAccountId: true, payoutsEnabledAt: true } },
    },
  },
} satisfies Prisma.BookingInclude;

/**
 * The queries behind host payouts — a booking's money after its payment, and the payout
 * account on a user. Apart from `BookingRepository` because none of it is about the slot.
 * Every write is conditional on what the caller read.
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

  /** Remembers the account opened for a user, only into an empty column. */
  async attachAccount(userId: string, accountId: string): Promise<void> {
    await this.prismaService.user.updateMany({
      where: { id: userId, stripeAccountId: null },
      data: { stripeAccountId: accountId },
    });
  }

  /**
   * Writes what Stripe last said about an account's transfers, and answers its user (`null`
   * for an account this API never opened). `newlyEnabled` is true only for the write that
   * switched it on, so of two runs with the same news one pays what was waiting.
   */
  async setPayoutsEnabled(
    accountId: string,
    enabled: boolean,
  ): Promise<{ userId: string; newlyEnabled: boolean } | null> {
    const user = await this.prismaService.user.findUnique({
      where: { stripeAccountId: accountId },
      select: { id: true },
    });

    if (user === null) return null;

    if (!enabled) {
      // Conditional, like the write below: the payouts page asks on every view while
      // onboarding is unfinished, and the column is already empty for all of those.
      await this.prismaService.user.updateMany({
        where: { id: user.id, payoutsEnabledAt: { not: null } },
        data: { payoutsEnabledAt: null },
      });

      return { userId: user.id, newlyEnabled: false };
    }

    // The moment is kept when it is already set: when payouts first opened is the fact.
    const { count } = await this.prismaService.user.updateMany({
      where: { id: user.id, payoutsEnabledAt: null },
      data: { payoutsEnabledAt: new Date() },
    });

    return { userId: user.id, newlyEnabled: count > 0 };
  }

  async findStay(bookingId: string): Promise<SettledStay | null> {
    return readStay(this.prismaService, bookingId);
  }

  /**
   * Runs `work` with the stay read under the settlement lease (`whileLeased`), which only
   * other settlements take: a run that arrives while another is between its read and its
   * write waits, and then reads what that one left. Without it two runs sized from the
   * same `paid_out_amount` reverse the same money under two different keys. A lease rather
   * than a lock held by a transaction, because the work calls Stripe.
   */
  async whileSettling<T>(
    bookingId: string,
    work: (
      stay: SettledStay | null,
      recordReversal: (from: number, to: number) => Promise<boolean>,
    ) => Promise<T>,
  ): Promise<T> {
    return whileLeased(
      this.prismaService,
      "settling_until",
      bookingId,
      SETTLE_LEASE,
      async () =>
        work(await readStay(this.prismaService, bookingId), (from, to) =>
          writeReversal(this.prismaService, bookingId, from, to),
        ),
    );
  }

  /** What a refund or a dispute event names: the payment, which is unique to one stay. */
  async findStayByPayment(paymentId: string): Promise<SettledStay | null> {
    const row = await this.prismaService.booking.findUnique({
      where: { paymentIntentId: paymentId },
      include: SETTLED_STAY_INCLUDE,
    });

    return row === null ? null : toSettledStay(row);
  }

  /**
   * The paid stays due and not yet sent, to a host who can be paid — a coarse cut over the
   * partial index; what is owed is the service's rule. A stay refunded in full is left out,
   * or every sweep would read it again for good. At most `limit`, the earliest check-ins
   * first; the next sweep reads the rest.
   */
  async findDuePayouts(
    now: Date,
    limit: number,
    hostId?: string,
  ): Promise<string[]> {
    const where: Prisma.BookingWhereInput = {
      paidAt: { not: null },
      transferId: null,
      // A refund still on its way is sent first; the stay comes back once it is recorded.
      refundOwed: null,
      // Due a fixed time after midnight of the check-in day, so every check-in on or before
      // the day that many hours ago is due. `from` is a `@db.Date`, compared as a day.
      from: { lte: subHours(now, PAYOUT_DELAY_HOURS) },
      AND: [
        { OR: [{ disputeStatus: null }, { disputeStatus: DisputeStatus.WON }] },
        {
          OR: [
            { refundedAmount: null },
            {
              refundedAmount: { lt: this.prismaService.booking.fields.amount },
            },
          ],
        },
      ],
      listing: {
        owner: {
          payoutsEnabledAt: { not: null },
          ...(hostId === undefined ? {} : { id: hostId }),
        },
      },
    };

    const rows = await this.prismaService.booking.findMany({
      where,
      select: { id: true },
      orderBy: { from: "asc" },
      take: limit,
    });

    return rows.map(({ id }) => id);
  }

  /**
   * Records a transfer, only into an empty column (`false`: another run recorded the same
   * one). A refund that landed meanwhile does not stop it — the money moved; `settle` follows.
   */
  async recordPayout(
    bookingId: string,
    transferId: string,
    amount: number,
  ): Promise<boolean> {
    const { count } = await this.prismaService.booking.updateMany({
      where: { id: bookingId, transferId: null },
      data: { transferId, paidOutAmount: amount, paidOutAt: new Date() },
    });

    return count > 0;
  }

  /**
   * Moves a dispute forward, never back — Stripe does not order its events, and a late
   * `created` must not reopen a settled dispute. `false`: already there or past it.
   */
  async setDisputeStatus(
    bookingId: string,
    status: DisputeState,
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

/**
 * Room for one Stripe call and the reads around it. A run that waits longer than ten
 * seconds gives up with `LeaseBusyError`, and its job or delivery comes again.
 */
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
 * Lowers what the host holds from exactly what the caller read. Still conditional under the
 * lease: it is what makes a write by anything that does not take the lease a `false`.
 */
async function writeReversal(
  client: Pick<Prisma.TransactionClient, "booking">,
  bookingId: string,
  from: number,
  to: number,
): Promise<boolean> {
  const { count } = await client.booking.updateMany({
    where: { id: bookingId, paidOutAmount: from },
    data: { paidOutAmount: to },
  });

  return count > 0;
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
    paidOutAmount: row.paidOutAmount?.toNumber() ?? null,
    destination: {
      accountId: row.listing.owner.stripeAccountId,
      enabled: row.listing.owner.payoutsEnabledAt !== null,
    },
  };
}
