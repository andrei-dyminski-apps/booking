import { Injectable } from "@nestjs/common";
import {
  RefundFailureStatus,
  type RefundFailure as RefundFailureView,
} from "@repo/contracts";
import type { Prisma } from "../../generated/prisma/client";
import { toIsoDate } from "../../common/iso-date";
import type { Page } from "../../common/paging";
import type { SetAsideCursor } from "../../common/set-aside-cursor";
import {
  cents,
  currencySchema,
  type Cents,
  type Currency,
} from "../../payment/domain/money";
import { PrismaService } from "../../prisma/prisma.service";

export type RefundFailure = {
  refundId: string;
  paymentId: string;
  /** `null` when no row names the payment any more. */
  bookingId: string | null;
  amountCents: Cents;
  currency: Currency;
  reason: string | null;
};

/** The stay a failure is listed with — one join, so the screen can link to it. */
const STAY_INCLUDE = {
  booking: {
    select: {
      id: true,
      listingId: true,
      from: true,
      to: true,
      listing: { select: { title: true } },
    },
  },
} satisfies Prisma.RefundFailureInclude;

type RefundFailureRow = Prisma.RefundFailureGetPayload<{
  include: typeof STAY_INCLUDE;
}>;

/** `refund_failures` — see the schema. */
@Injectable()
export class RefundFailureRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /** `false` for a redelivery, so only the run that wrote the row tells the admins. */
  async record(failure: RefundFailure): Promise<boolean> {
    const { count } = await this.prismaService.refundFailure.createMany({
      data: [failure],
      skipDuplicates: true,
    });

    return count > 0;
  }

  /** Newest first, over `(failed_at DESC, refund_id DESC)`; the key said twice, as everywhere. */
  async findPage(
    status: RefundFailureStatus,
    cursor: SetAsideCursor | null,
    limit: number,
  ): Promise<Page<RefundFailureView>> {
    const rows = await this.prismaService.refundFailure.findMany({
      where: {
        AND: [
          status === RefundFailureStatus.OPEN
            ? { resolvedAt: null }
            : { resolvedAt: { not: null } },
          cursor === null
            ? {}
            : {
                failedAt: { lte: cursor.at },
                OR: [
                  { failedAt: { lt: cursor.at } },
                  { failedAt: cursor.at, refundId: { lt: cursor.id } },
                ],
              },
        ],
      },
      include: STAY_INCLUDE,
      orderBy: [{ failedAt: "desc" }, { refundId: "desc" }],
      take: limit + 1,
    });

    return {
      items: rows.slice(0, limit).map(toRefundFailure),
      hasMore: rows.length > limit,
    };
  }

  /** Only an open one, so of two admins resolving at once the first one's words are kept. */
  async resolve(refundId: string, resolution: string): Promise<boolean> {
    const { count } = await this.prismaService.refundFailure.updateMany({
      where: { refundId, resolvedAt: null },
      data: { resolvedAt: new Date(), resolution },
    });

    return count > 0;
  }

  async exists(refundId: string): Promise<boolean> {
    return (
      (await this.prismaService.refundFailure.count({ where: { refundId } })) >
      0
    );
  }
}

function toRefundFailure(row: RefundFailureRow): RefundFailureView {
  return {
    refundId: row.refundId,
    paymentId: row.paymentId,
    amountCents: cents(row.amountCents),
    currency: currencySchema.parse(row.currency),
    reason: row.reason,
    failedAt: row.failedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolution: row.resolution,
    stay:
      row.booking === null
        ? null
        : {
            bookingId: row.booking.id,
            listingId: row.booking.listingId,
            listingTitle: row.booking.listing.title,
            from: toIsoDate(row.booking.from),
            to: toIsoDate(row.booking.to),
          },
  };
}
