import { InjectQueue } from "@nestjs/bullmq";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { Queue } from "bullmq";
import { BookingJobs } from "../application/ports/booking-jobs";

export const BOOKING_EXPIRY_QUEUE = "booking-expiry";

export const EXPIRE_HOLD_JOB = "expire-hold";

export const SWEEP_LAPSED_HOLDS_JOB = "sweep-lapsed-holds";

export const WITHDRAW_PAYMENT_JOB = "withdraw-payment";

export const REFUND_CANCELLATION_JOB = "refund-cancellation";

export const SWEEP_OWED_REFUNDS_JOB = "sweep-owed-refunds";

/** The worst delay of a hold whose own job was lost. */
export const SWEEP_INTERVAL_MS = 60 * 1000;

const SWEEP_SCHEDULER_ID = "lapsed-holds-sweep";

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
    void this.registerSweep(SWEEP_SCHEDULER_ID, SWEEP_LAPSED_HOLDS_JOB);
    void this.registerSweep(REFUND_SWEEP_SCHEDULER_ID, SWEEP_OWED_REFUNDS_JOB);
  }

  async scheduleExpiry(bookingId: string, runAt: Date): Promise<void> {
    try {
      await this.queue.add(
        EXPIRE_HOLD_JOB,
        { bookingId },
        {
          jobId: expireHoldJobId(bookingId),
          delay: Math.max(0, runAt.getTime() - Date.now()),
          removeOnComplete: true,
          removeOnFail: true,
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
          removeOnComplete: true,
          removeOnFail: true,
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
          removeOnComplete: true,
          removeOnFail: true,
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

  private async registerSweep(
    schedulerId: string,
    name: typeof SWEEP_LAPSED_HOLDS_JOB | typeof SWEEP_OWED_REFUNDS_JOB,
  ): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        schedulerId,
        { every: SWEEP_INTERVAL_MS },
        {
          name,
          data: {},
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      );
    } catch (error) {
      // Logged rather than raised: the per-booking jobs and the check inside `create` still run.
      this.logger.error(
        `Could not register the ${name} sweep — only the per-booking jobs and the check inside create will run: ${String(error)}`,
      );
    }
  }
}
