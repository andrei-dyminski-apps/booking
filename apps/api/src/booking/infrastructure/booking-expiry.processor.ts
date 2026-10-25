import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { BookingService } from "../application/booking.service";
import {
  BOOKING_EXPIRY_QUEUE,
  EXPIRE_HOLD_JOB,
  REFUND_CANCELLATION_JOB,
  WITHDRAW_PAYMENT_JOB,
  type BookingExpiryJobData,
  type ExpireHoldJobData,
  type RefundCancellationJobData,
  type WithdrawPaymentJobData,
} from "./booking-expiry.queue";

/**
 * The proactive half of hold expiry, in two jobs over one queue: `expire-hold` releases
 * the hold it names at that hold's own deadline, and the repeatable `sweep-lapsed-holds`
 * releases whatever the first one missed — a job lost with the Redis it lived in, a
 * `scheduleExpiry` that never reached the queue at all. The lazy half runs inside
 * `BookingRepository.create`.
 *
 * Both updates match only a still-pending, past-deadline row, so a job that fires after
 * the booking was paid or cancelled is a harmless no-op and a job that runs twice is the
 * same one. They go through `BookingService` rather than the repository, because a
 * released hold is news to both of its sides.
 *
 * Two more jobs are what letting a stay go leaves behind at Stripe, done here rather than
 * in the request or the job that let it go: `withdraw-payment` withdraws a hold's
 * PaymentIntent, and `refund-cancellation` sends the refund a cancellation owes. A failure
 * of either is thrown, so BullMQ tries it again — and the sweep sends whatever refund is
 * still owed after that, since the debt is on the row and not only in Redis.
 */
@Processor(BOOKING_EXPIRY_QUEUE)
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

    const released = await this.bookingService.releaseLapsedHolds();
    const refunded = await this.bookingService.refundOwedCancellations();

    // Quiet on the usual outcome: this runs every minute and has nothing to do most times.
    if (released > 0) {
      this.logger.log(`Swept ${String(released)} lapsed hold(s)`);
    }

    if (refunded > 0) {
      this.logger.log(`Sent ${String(refunded)} owed cancellation refund(s)`);
    }
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
