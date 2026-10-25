import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

/** A refund the guest's bank sent back, as `refund.failed` names it. */
export type RefundFailure = {
  refundId: string;
  paymentId: string;
  /** The stay the payment confirmed or was opened for; `null` when no row names it any more. */
  bookingId: string | null;
  amount: number;
  reason: string | null;
};

/**
 * The record of refunds that came back — `refund_failures`, see the schema. A row is the
 * money still owed to a guest that nothing re-sends on its own; a person issues the refund
 * again and stamps `resolved_at`.
 */
@Injectable()
export class RefundFailureRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Keyed by the provider's refund id, so a redelivery of the event writes nothing and
   * answers `false` — the run that wrote the row is the one that tells the admins.
   */
  async record(failure: RefundFailure): Promise<boolean> {
    const { count } = await this.prismaService.refundFailure.createMany({
      data: [failure],
      skipDuplicates: true,
    });

    return count > 0;
  }
}
