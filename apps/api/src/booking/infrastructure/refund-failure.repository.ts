import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export type RefundFailure = {
  refundId: string;
  paymentId: string;
  /** `null` when no row names the payment any more. */
  bookingId: string | null;
  amount: number;
  reason: string | null;
};

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
}
