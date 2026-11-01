import { Injectable } from "@nestjs/common";
import {
  refundFailureSchema,
  type RefundFailurePage,
  type RefundFailureQuery,
  type ResolveRefundFailureInput,
} from "@repo/contracts";
import { readCursor } from "../../common/paging";
import { writeOrRefuse } from "../../common/set-aside";
import {
  decodeSetAsideCursor,
  nextSetAsideCursor,
} from "../../common/set-aside-cursor";
import { RefundFailureRepository } from "../infrastructure/refund-failure.repository";

/**
 * The refunds a guest's bank sent back, as an admin works through them. Nothing here sends
 * money: the same card refuses the same refund, so the money goes back some other way and
 * this records how.
 */
@Injectable()
export class RefundFailureService {
  constructor(
    private readonly refundFailureRepository: RefundFailureRepository,
  ) {}

  async findPage(query: RefundFailureQuery): Promise<RefundFailurePage> {
    // The status is in the tag: a cursor of the open list names no place among the resolved.
    const resource = `refund-failures-${query.status}`;
    const cursor = readCursor(query.cursor, "newest", (raw) =>
      decodeSetAsideCursor(resource, raw, refundFailureSchema.shape.refundId),
    );
    const page = await this.refundFailureRepository.findPage(
      query.status,
      cursor,
      query.limit,
    );

    return {
      items: page.items,
      nextCursor: nextSetAsideCursor(resource, page, (row) => ({
        at: row.failedAt,
        id: row.refundId,
      })),
    };
  }

  /** `409` for one resolved already — its resolution is the record, and stays as written. */
  async resolve(
    refundId: string,
    input: ResolveRefundFailureInput,
  ): Promise<void> {
    await writeOrRefuse(
      this.refundFailureRepository.resolve(refundId, input.resolution),
      () => this.refundFailureRepository.exists(refundId),
      {
        conflict: `The failed refund ${refundId} is resolved already`,
        notFound: `Failed refund ${refundId} not found`,
      },
    );
  }
}
