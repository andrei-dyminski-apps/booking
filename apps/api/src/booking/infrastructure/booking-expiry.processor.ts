import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { logJobFailure } from "../../common/job-failure";
import { BookingService } from "../application/booking.service";
import {
  BOOKING_EXPIRY_QUEUE,
  EXPIRE_HOLD_JOB,
  REFUND_CANCELLATION_JOB,
  SWEEP_OWED_REFUNDS_JOB,
  WITHDRAW_PAYMENT_JOB,
  type BookingExpiryJobData,
  type ExpireHoldJobData,
  type RefundCancellationJobData,
  type WithdrawPaymentJobData,
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

  constructor(private readonly bookingService: BookingService) {
    super();
  }

  async process(job: Job<BookingExpiryJobData>): Promise<void> {
    if (isWithdrawPaymentJob(job)) {
      await this.bookingService.withdrawPayment(job.data.paymentId);

      return;
    }

    if (isRefundCancellationJob(job)) {
      await this.bookingService.refundCancellation(job.data.bookingId);

      return;
    }

    if (isExpireHoldJob(job)) {
      await this.bookingService.releaseHold(job.data.bookingId);
      this.logger.debug(`Ran hold expiry for booking ${job.data.bookingId}`);

      return;
    }

    if (job.name === SWEEP_OWED_REFUNDS_JOB) {
      const refunded = await this.bookingService.refundOwedCancellations();

      if (refunded > 0) {
        this.logger.log(`Sent ${String(refunded)} owed cancellation refund(s)`);
      }

      return;
    }

    const released = await this.bookingService.releaseLapsedHolds();

    // Quiet on the usual outcome: this runs every minute and has nothing to do most times.
    if (released > 0) {
      this.logger.log(`Swept ${String(released)} lapsed hold(s)`);
    }
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job<BookingExpiryJobData> | undefined, error: Error): void {
    logJobFailure(this.logger, job, error);
  }
}

function isExpireHoldJob(
  job: Job<BookingExpiryJobData>,
): job is Job<ExpireHoldJobData> {
  return job.name === EXPIRE_HOLD_JOB;
}

function isWithdrawPaymentJob(
  job: Job<BookingExpiryJobData>,
): job is Job<WithdrawPaymentJobData> {
  return job.name === WITHDRAW_PAYMENT_JOB;
}

function isRefundCancellationJob(
  job: Job<BookingExpiryJobData>,
): job is Job<RefundCancellationJobData> {
  return job.name === REFUND_CANCELLATION_JOB;
}
