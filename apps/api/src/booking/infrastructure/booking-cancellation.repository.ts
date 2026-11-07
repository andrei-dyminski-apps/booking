import { Injectable } from "@nestjs/common";
import { BookingStatus } from "@repo/contracts";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { cents, type Cents } from "../../payment/domain/money";
import { ACTIVE_STATUSES } from "../domain/booking-status";
import { CancellationInProgressError } from "../domain/booking.errors";
import type { CancellationBy, CancelledStay } from "../domain/booking.types";
import { LeaseBusyError, whileLeased, type LeaseTiming } from "./booking-lease";
import { countedCancellationsWhere } from "./booking.repository";

/**
 * The cancellation of a stay and the lease it is taken under. The lease is the one place
 * `cancelling_until` is taken: the refund job and the payment webhooks take it through
 * `whileCancelling` too, so a refund write never lands in the middle of a cancellation.
 */
@Injectable()
export class BookingCancellationRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Cancelling keeps the row and moves it out of the active set: the record is what phase
   * 5 refunds against, and an inactive status frees the slot the `EXCLUDE` constraint
   * guards. `expiresAt` is left where it is — the deadline this hold had is part of that
   * record, and `status` is what says it no longer holds anything. `false` is the row
   * already being gone from the active set — cancelled or expired by another request
   * between the read that authorized this one and here. `updateMany` reports that in a
   * count instead of an exception, the same trade the old `delete` made with `deleteMany`.
   *
   * What the cancellation gives back is written in the same statement (`refund_owed_cents`), so
   * it is never answered while the money it owes is written nowhere. It matches only the
   * status the refund was decided by — `null` for a hold confirmed in between too — and
   * reads the payment back from the `UPDATE`, so one attached meanwhile is withdrawn.
   */
  async cancel(
    id: string,
    status: BookingStatus,
    refundOwedCents: Cents | null,
    by: CancellationBy | null = null,
  ): Promise<CancelledStay | null> {
    const feeCents = by?.feeCents ?? null;
    const write = async (
      client: Pick<Prisma.TransactionClient, "booking" | "hostFee">,
    ): Promise<CancelledStay | null> => {
      const [cancelled] = await client.booking.updateManyAndReturn({
        where: {
          id,
          AND: [{ status: { in: [...ACTIVE_STATUSES] } }, { status }],
        },
        data: {
          status: BookingStatus.CANCELLED,
          refundOwedCents,
          ...(by === null
            ? {}
            : {
                cancelledBy: by.canceller,
                cancelledAt: new Date(),
                cancellationReason: by.reason,
              }),
        },
        select: {
          paymentIntentId: true,
          currency: true,
          listing: { select: { ownerId: true } },
        },
      });

      if (cancelled === undefined) return null;

      const fee =
        feeCents === null
          ? null
          : await client.hostFee.create({
              data: {
                bookingId: id,
                hostId: cancelled.listing.ownerId,
                amountCents: feeCents,
                currency: cancelled.currency,
              },
              select: { id: true, amountCents: true },
            });

      return {
        paymentId: cancelled.paymentIntentId,
        fee:
          fee === null
            ? null
            : { id: fee.id, amountCents: cents(fee.amountCents) },
      };
    };

    // A fee goes in the cancellation's own transaction: a host is never let off a stay they
    // took away by a process that died between the two writes, nor charged for one that
    // stayed. Without one the cancellation is a single statement and needs none.
    return feeCents === null
      ? write(this.prismaService)
      : this.prismaService.$transaction(write);
  }

  /**
   * How many paid stays this host cancelled within the window that ends at `now`
   * (`countedCancellationsWhere`), and the host's name, for the notice that tells the admins.
   * `null` for a host who is gone.
   */
  async hostCancellations(
    hostId: string,
    now: Date,
  ): Promise<{ name: string; cancellations: number } | null> {
    const host = await this.prismaService.user.findUnique({
      where: { id: hostId },
      select: {
        name: true,
        _count: {
          select: {
            hostFees: { where: countedCancellationsWhere(hostId, now) },
          },
        },
      },
    });

    return host === null
      ? null
      : { name: host.name, cancellations: host._count.hostFees };
  }

  /**
   * The cancellation lease, which the refund job and the payment webhooks take too: the
   * webhook reporting a refund waits here instead of reading the stay half way.
   */
  async whileCancelling<T>(id: string, work: () => Promise<T>): Promise<T> {
    try {
      return await whileLeased(
        this.prismaService,
        "cancelling_until",
        id,
        CANCEL_LEASE,
        work,
      );
    } catch (error) {
      if (error instanceof LeaseBusyError) {
        throw new CancellationInProgressError(id);
      }

      throw error;
    }
  }
}

/**
 * Sixty seconds of room for a refund and a settlement; three of waiting keep a cancellation
 * inside the frontend's ten. Each try is an `UPDATE`, so the tries back off.
 */
const CANCEL_LEASE: LeaseTiming = {
  leaseMs: 60_000,
  waitMs: 3_000,
  pollMs: 100,
  pollMaxMs: 1_000,
};
