import { Injectable } from "@nestjs/common";
import {
  RefundFailureStatus,
  type RefundFailure as RefundFailureView,
  type RefundFailureQuery,
} from "@repo/contracts";
import type { Prisma } from "../../generated/prisma/client";
import { toIsoDate } from "../../common/iso-date";
import type { Page } from "../../common/paging";
import type { SetAsideCursor } from "../../common/set-aside-cursor";
import { setAsideWithin } from "../../common/set-aside-window";
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

/** What the admin's list of bounced refunds narrows by, past its status. */
export type RefundFailureFilters = Pick<
  RefundFailureQuery,
  | "refundId"
  | "paymentId"
  | "bookingId"
  | "listingId"
  | "guestId"
  | "hostId"
  | "from"
  | "to"
>;

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
    filters: RefundFailureFilters,
  ): Promise<Page<RefundFailureView>> {
    const rows = await this.prismaService.refundFailure.findMany({
      where: {
        AND: [
          status === RefundFailureStatus.OPEN
            ? { resolvedAt: null }
            : { resolvedAt: { not: null } },
          {
            refundId: filters.refundId,
            paymentId: filters.paymentId,
            bookingId: filters.bookingId,
            failedAt: setAsideWithin(filters),
          },
          // Only a filter that names the stay's side joins it: an orphaned refund has no stay
          // and is left out by any of them, kept by none.
          filters.listingId === undefined &&
          filters.guestId === undefined &&
          filters.hostId === undefined
            ? {}
            : {
                booking: {
                  is: {
                    listingId: filters.listingId,
                    guestId: filters.guestId,
                    // Only when a host is named: an empty filter on the relation still joins it.
                    ...(filters.hostId === undefined
                      ? {}
                      : { listing: { ownerId: filters.hostId } }),
                  },
                },
              },
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
