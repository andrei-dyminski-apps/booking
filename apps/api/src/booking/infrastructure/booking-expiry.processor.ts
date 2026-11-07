import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { logJobFailure, unknownJob } from "../../common/job-failure";
import { BookingRefundService } from "../application/booking-refund.service";
import { BookingService } from "../application/booking.service";
import {
  BOOKING_EXPIRY_QUEUE,
  EXPIRE_HOLD_JOB,
  REFUND_CANCELLATION_JOB,
  SWEEP_LAPSED_HOLDS_JOB,
  SWEEP_OWED_REFUNDS_JOB,
  WITHDRAW_PAYMENT_JOB,
  type BookingExpiryJob,
} from "./booking-expiry.queue";

const WORKER_CONCURRENCY = 4;

/**
 * The releases match only a pending, past-deadline row, so a late or repeated job is a
 * no-op, and they go through `BookingService` because a released hold is news to both
 * sides. Several jobs at a time, so a refund waiting on Stripe or a lease does not hold a
 * release behind it — the releases are conditional and the refunds run under the lease.
 */
@Processor(BOOKING_EXPIRY_QUEUE, { concurrency: WORKER_CONCURRENCY })
export class BookingExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(BookingExpiryProcessor.name);

  constructor(
    private readonly bookingService: BookingService,
    private readonly bookingRefundService: BookingRefundService,
  ) {
    super();
  }

  async process(job: BookingExpiryJob): Promise<void> {
    const { name, data } = job;

    switch (name) {
      case WITHDRAW_PAYMENT_JOB:
        await this.bookingService.withdrawPayment(data.paymentId);

        return;
      case REFUND_CANCELLATION_JOB:
        await this.bookingRefundService.refundCancellation(data.bookingId);

        return;
      case EXPIRE_HOLD_JOB:
        await this.bookingService.releaseHold(data.bookingId);
        this.logger.debug(`Ran hold expiry for booking ${data.bookingId}`);

        return;
      case SWEEP_OWED_REFUNDS_JOB: {
        const refunded =
          await this.bookingRefundService.refundOwedCancellations();

        if (refunded > 0) {
          this.logger.log(
            `Sent ${String(refunded)} owed cancellation refund(s)`,
          );
        }

        return;
      }
      case SWEEP_LAPSED_HOLDS_JOB: {
        const released = await this.bookingService.releaseLapsedHolds();

        // Quiet on the usual outcome: this runs every minute and has nothing to do most times.
        if (released > 0) {
          this.logger.log(`Swept ${String(released)} lapsed hold(s)`);
        }

        return;
      }
      default:
        unknownJob(name);
    }
  }

  @OnWorkerEvent("failed")
  onFailed(job: BookingExpiryJob | undefined, error: Error): void {
    logJobFailure(this.logger, job, error);
  }
}
