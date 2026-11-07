import type {
  RefundFailure as RefundFailureView,
  RefundFailureStatus,
} from "@repo/contracts";
import type { Page } from "../../../common/paging";
import type { SetAsideCursor } from "../../../common/set-aside-cursor";
import type { PublicOf } from "../../../common/testing/public-of.fakes";
import type {
  RefundFailureRepository,
  RefundFailure,
} from "../../infrastructure/refund-failure.repository";
import { compare } from "./booking-fixtures.fakes";

/** The failures by refund id, written once each the way the unique key writes them. */
export class FakeRefundFailureRepository implements PublicOf<RefundFailureRepository> {
  readonly failures = new Map<string, RefundFailure>();

  /** When each was written, a second apart, and how each was resolved. */
  private readonly failedAt = new Map<string, string>();
  readonly resolutions = new Map<string, string>();

  record(failure: RefundFailure): Promise<boolean> {
    if (this.failures.has(failure.refundId)) return Promise.resolve(false);

    this.failures.set(failure.refundId, failure);
    this.failedAt.set(
      failure.refundId,
      new Date(
        Date.parse("2026-10-25T12:00:00.000Z") + this.failures.size * 1_000,
      ).toISOString(),
    );

    return Promise.resolve(true);
  }

  /** Newest first; the stay is the join's, which e2e covers, so it is left `null` here. */
  findPage(
    status: RefundFailureStatus,
    cursor: SetAsideCursor | null,
    limit: number,
  ): Promise<Page<RefundFailureView>> {
    const matching = [...this.failures.values()]
      .filter(
        ({ refundId }) =>
          this.resolutions.has(refundId) === (status === "RESOLVED"),
      )
      .map((failure): RefundFailureView => {
        const resolution = this.resolutions.get(failure.refundId) ?? null;

        return {
          refundId: failure.refundId,
          paymentId: failure.paymentId,
          amountCents: failure.amountCents,
          currency: failure.currency,
          reason: failure.reason,
          failedAt: this.failedAt.get(failure.refundId) ?? "",
          resolvedAt: resolution === null ? null : "2026-10-26T12:00:00.000Z",
          resolution,
          stay: null,
        };
      })
      .sort((left, right) => compare(right.failedAt, left.failedAt));
    const start =
      cursor === null
        ? 0
        : matching.findIndex(({ refundId }) => refundId === cursor.id) + 1;

    return Promise.resolve({
      items: matching.slice(start, start + limit),
      hasMore: matching.length > start + limit,
    });
  }

  resolve(refundId: string, resolution: string): Promise<boolean> {
    if (!this.failures.has(refundId) || this.resolutions.has(refundId)) {
      return Promise.resolve(false);
    }

    this.resolutions.set(refundId, resolution);

    return Promise.resolve(true);
  }

  exists(refundId: string): Promise<boolean> {
    return Promise.resolve(this.failures.has(refundId));
  }
}
