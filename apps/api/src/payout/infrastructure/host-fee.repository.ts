import { Injectable } from "@nestjs/common";
import { Role, type HostFee } from "@repo/contracts";
import type { Prisma } from "../../generated/prisma/client";
import { toIsoDate } from "../../common/iso-date";
import {
  cancellationsWindowStart,
  countedCancellationsWhere,
  owedFeesWhere,
} from "../../booking/infrastructure/booking-where";
import { cents, currencySchema } from "../../payment/domain/money";
import { PrismaService } from "../../prisma/prisma.service";
import {
  WaivingAccountGoneError,
  WaivingAccountNotAdminError,
} from "../domain/payout.errors";
import type { HostFeeReader } from "../domain/payout.types";
import { lockHostFees } from "./payout.repository";

const HOST_FEE_INCLUDE = {
  booking: {
    select: {
      from: true,
      to: true,
      cancellationReason: true,
      listing: { select: { title: true } },
    },
  },
} satisfies Prisma.HostFeeInclude;

/** Read for an admin only: a host's overview does not join the waiver's author at all. */
const WAIVED_BY = {
  select: { id: true, name: true },
} satisfies Prisma.UserDefaultArgs;

/** The admin's row in `waive`, raw SQL, so the columns keep their stored names. */
type LockedAdmin = { role: Role; blocked_at: Date | null };

/**
 * The ledger of what hosts owe for their cancellations, as the screens read it and an admin
 * waives it. The row is written by `BookingCancellationRepository.cancel` and withheld from by
 * `PayoutRepository.reservePayout`; this class only reads it and waives it.
 */
@Injectable()
export class HostFeeRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * The fees of one host still owed and every one written within the window ending at `now`,
   * waived ones included, newest first; and how many cancellations count in that window —
   * the same count the admins' threshold notice reads (`countedCancellationsWhere`).
   */
  async overviewOf(
    hostId: string,
    reader: HostFeeReader,
    now: Date,
  ): Promise<{ fees: HostFee[]; cancellationsInWindow: number }> {
    const [rows, cancellationsInWindow] = await this.prismaService.$transaction(
      [
        this.prismaService.hostFee.findMany({
          where: {
            OR: [
              { hostId, createdAt: { gte: cancellationsWindowStart(now) } },
              owedFeesWhere(this.prismaService, hostId),
            ],
          },
          include: {
            ...HOST_FEE_INCLUDE,
            waivedBy: reader === "admin" ? WAIVED_BY : false,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        this.prismaService.hostFee.count({
          where: countedCancellationsWhere(hostId, now),
        }),
      ],
    );

    return { fees: rows.map(toHostFee), cancellationsInWindow };
  }

  /**
   * Only a fee still owed: one waived already keeps its first reason, and one withheld in
   * full has nothing left to forgive. Under the host's lock, like every write that changes
   * what the host owes: a payout's reservation reads the fees owed and then keeps back from
   * them, and a waiver landing between the two would leave it keeping back more than is owed.
   *
   * The admin's row is read under `FOR KEY SHARE` first, before the fee — the caller is
   * settled before anything about the fee, so a missing id tells a session that outlived
   * its account nothing. The role in the token is not trusted here: the API changes no
   * role and blocks no admin, but a write to `users` outside it does both, and the token
   * keeps its claim until the next refresh. So the row has to be an active admin's as well.
   * The lock keeps the row from being deleted before the waiver names it, and leaves the
   * account's other writes alone — a payout account's update takes no key lock.
   */
  async waive(id: string, reason: string, adminId: string): Promise<boolean> {
    return this.prismaService.$transaction(async (tx) => {
      const [admin] = await tx.$queryRaw<LockedAdmin[]>`
        SELECT role, blocked_at FROM users
        WHERE id = ${adminId}::uuid
        FOR KEY SHARE
      `;

      if (admin === undefined) throw new WaivingAccountGoneError(adminId);

      if (admin.role !== Role.ADMIN || admin.blocked_at !== null) {
        throw new WaivingAccountNotAdminError(adminId);
      }

      const fee = await tx.hostFee.findUnique({
        where: { id },
        select: { hostId: true },
      });

      if (fee === null) return false;

      await lockHostFees(tx, fee.hostId);

      const { count } = await tx.hostFee.updateMany({
        where: { id, ...owedFeesWhere(tx, fee.hostId) },
        data: {
          waivedAt: new Date(),
          waiveReason: reason,
          waivedById: adminId,
        },
      });

      return count > 0;
    });
  }

  async exists(id: string): Promise<boolean> {
    return (await this.prismaService.hostFee.count({ where: { id } })) > 0;
  }
}

/** `waivedBy` is absent from a host's rows: it is not joined for them. */
type HostFeeRow = Prisma.HostFeeGetPayload<{
  include: typeof HOST_FEE_INCLUDE;
}> & {
  waivedBy?: Prisma.UserGetPayload<typeof WAIVED_BY> | null;
};

function toHostFee(row: HostFeeRow): HostFee {
  return {
    id: row.id,
    bookingId: row.bookingId,
    hostId: row.hostId,
    listingTitle: row.booking.listing.title,
    from: toIsoDate(row.booking.from),
    to: toIsoDate(row.booking.to),
    amountCents: cents(row.amountCents),
    withheldCents: cents(row.withheldCents),
    currency: currencySchema.parse(row.currency),
    cancellationReason: row.booking.cancellationReason,
    waivedAt: row.waivedAt?.toISOString() ?? null,
    waiveReason: row.waiveReason,
    waivedBy: row.waivedBy ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
