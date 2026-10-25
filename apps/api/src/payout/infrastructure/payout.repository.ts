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
  RELEASED_HOLD_INCLUDE,
  toRefundTarget,
} from "../../booking/infrastructure/stay-rows";
import type { SetAside } from "../../common/job-failure";
import { PrismaService } from "../../prisma/prisma.service";
import { SettlementInProgressError } from "../domain/payout.errors";
import type { PayoutAccountHolder, SettledStay } from "../domain/payout.types";

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
   * `null` for an account this API never opened. `newlyEnabled` only for the write that
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
      await this.prismaService.user.updateMany({
        where: { id: user.id, payoutsEnabledAt: { not: null } },
        data: { payoutsEnabledAt: null },
      });

      return { userId: user.id, newlyEnabled: false };
    }

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
   * The stay read under the settlement lease: without it two runs sized from the same
   * `paid_out_amount` reverse the same money under two different keys. A lease held past
   * the wait is `SettlementInProgressError`, the way `whileCancelling` answers its own.
   */
  async whileSettling<T>(
    bookingId: string,
    work: (
      stay: SettledStay | null,
      recordReversal: (from: number, to: number) => Promise<boolean>,
    ) => Promise<T>,
  ): Promise<T> {
    try {
      return await whileLeased(
        this.prismaService,
        "settling_until",
        bookingId,
        SETTLE_LEASE,
        async () =>
          work(await readStay(this.prismaService, bookingId), (from, to) =>
            writeReversal(this.prismaService, bookingId, from, to),
          ),
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
   * in full is left out, or every sweep would read it again for good.
   */
  async findDuePayouts(
    now: Date,
    limit: number,
    hostId?: string,
  ): Promise<string[]> {
    const where: Prisma.BookingWhereInput = {
      paidAt: { not: null },
      transferId: null,
      payoutFailedAt: null,
      // A refund still on its way is sent first; the stay comes back once it is recorded.
      refundOwed: null,
      // `from` is a `@db.Date`, compared as a day.
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
      transferId: null,
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

  /** Only into an empty column. A refund that landed meanwhile does not stop it; `settle` follows. */
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

/** Conditional even under the lease, so a write by anything outside it reads as `false`. */
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
