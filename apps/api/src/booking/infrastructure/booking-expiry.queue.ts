import { InjectQueue } from "@nestjs/bullmq";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { type Job, Queue } from "bullmq";
import { DISPOSABLE, registerSweep } from "../../common/job-options";
import { BookingJobs } from "../application/ports/booking-jobs";

export const BOOKING_EXPIRY_QUEUE = "booking-expiry";

export const EXPIRE_HOLD_JOB = "expire-hold";

export const SWEEP_LAPSED_HOLDS_JOB = "sweep-lapsed-holds";

export const WITHDRAW_PAYMENT_JOB = "withdraw-payment";

export const REFUND_CANCELLATION_JOB = "refund-cancellation";

export const SWEEP_OWED_REFUNDS_JOB = "sweep-owed-refunds";

/** The worst delay of a hold whose own job was lost. */
export const SWEEP_INTERVAL_MS = 60 * 1000;

const HOLD_SWEEP_SCHEDULER_ID = "lapsed-holds-sweep";

/** Apart from the hold sweep, so a slow or failing Stripe delays the refunds alone. */
const REFUND_SWEEP_SCHEDULER_ID = "owed-refunds-sweep";

function expireHoldJobId(bookingId: string): string {
  return `hold-${bookingId}`;
}

export type ExpireHoldJobData = { bookingId: string };

export type SweepJobData = Record<string, never>;

export type WithdrawPaymentJobData = { paymentId: string };

export type RefundCancellationJobData = { bookingId: string };

export type BookingExpiryJobData =
  | ExpireHoldJobData
  | SweepJobData
  | WithdrawPaymentJobData
  | RefundCancellationJobData;

/** What the worker is handed: the name decides the data, as in `PaymentEventJob`. */
export type BookingExpiryJob =
  | Job<ExpireHoldJobData, void, typeof EXPIRE_HOLD_JOB>
  | Job<SweepJobData, void, typeof SWEEP_LAPSED_HOLDS_JOB>
  | Job<WithdrawPaymentJobData, void, typeof WITHDRAW_PAYMENT_JOB>
  | Job<RefundCancellationJobData, void, typeof REFUND_CANCELLATION_JOB>
  | Job<SweepJobData, void, typeof SWEEP_OWED_REFUNDS_JOB>;

/**
 * A job per hold at its deadline and a sweep behind it, plus the withdrawals and refunds
 * the stays leave. Redis runs without a volume, so the sweep is what makes losing a job
 * survivable; nothing here fails a request, because the booking has committed already.
 */
@Injectable()
export class BookingExpiryQueue
  extends BookingJobs
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(BookingExpiryQueue.name);

  constructor(
    @InjectQueue(BOOKING_EXPIRY_QUEUE)
    private readonly queue: Queue<BookingExpiryJobData>,
  ) {
    super();
  }

  /** Not awaited: a slow Redis must not hold the API's boot open. */
  onApplicationBootstrap(): void {
    void registerSweep<BookingExpiryJob["name"]>(
      this.queue,
      this.logger,
      {
        schedulerId: HOLD_SWEEP_SCHEDULER_ID,
        name: SWEEP_LAPSED_HOLDS_JOB,
        every: SWEEP_INTERVAL_MS,
      },
      `Could not register the ${SWEEP_LAPSED_HOLDS_JOB} sweep — only the per-booking jobs and the check inside create will run`,
    );
    void registerSweep<BookingExpiryJob["name"]>(
      this.queue,
      this.logger,
      {
        schedulerId: REFUND_SWEEP_SCHEDULER_ID,
        name: SWEEP_OWED_REFUNDS_JOB,
        every: SWEEP_INTERVAL_MS,
      },
      `Could not register the ${SWEEP_OWED_REFUNDS_JOB} sweep — refunds will only be sent by their own job`,
    );
  }

  async scheduleExpiry(bookingId: string, runAt: Date): Promise<void> {
    try {
      await this.queue.add(
        EXPIRE_HOLD_JOB,
        { bookingId },
        {
          jobId: expireHoldJobId(bookingId),
          delay: Math.max(0, runAt.getTime() - Date.now()),
          ...DISPOSABLE,
        },
      );
    } catch (error) {
      // Throwing would answer a committed booking with a 500; the sweep releases it instead.
      this.logger.warn(
        `Could not schedule the expiry job for booking ${bookingId}, leaving it to the sweep: ${String(error)}`,
      );
    }
  }

  /**
   * Out of the request, which would otherwise wait on Stripe per released hold. A payment
   * whose withdrawal never reached the queue and completes anyway is refunded by the webhook.
   */
  async withdrawPayment(paymentId: string): Promise<void> {
    try {
      await this.queue.add(
        WITHDRAW_PAYMENT_JOB,
        { paymentId },
        {
          jobId: `withdraw-${paymentId}`,
          attempts: 5,
          backoff: { type: "exponential", delay: 10_000 },
          ...DISPOSABLE,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not queue the withdrawal of payment ${paymentId}, the webhook refunds it if it completes: ${String(error)}`,
      );
    }
  }

  /** The row owes the refund, not this job: one that never reaches the queue is swept. */
  async refundCancellation(bookingId: string): Promise<void> {
    try {
      await this.queue.add(
        REFUND_CANCELLATION_JOB,
        { bookingId },
        {
          jobId: `refund-${bookingId}`,
          attempts: 5,
          backoff: { type: "exponential", delay: 10_000 },
          ...DISPOSABLE,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not queue the refund of booking ${bookingId}, leaving it to the sweep: ${String(error)}`,
      );
    }
  }

  /** Best effort: the job may have run already or never existed, and it is idempotent. */
  async cancelExpiry(bookingId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(expireHoldJobId(bookingId));

      await job?.remove();
    } catch (error) {
      this.logger.warn(
        `Could not cancel the expiry job for booking ${bookingId}: ${String(error)}`,
      );
    }
  }
}
