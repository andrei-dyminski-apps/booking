import { InjectQueue } from "@nestjs/bullmq";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { Queue } from "bullmq";

export const BOOKING_EXPIRY_QUEUE = "booking-expiry";

/** Releases the one hold it names, and runs at that hold's own deadline. */
export const EXPIRE_HOLD_JOB = "expire-hold";

/** Releases every lapsed hold there is, and runs on a schedule. */
export const SWEEP_LAPSED_HOLDS_JOB = "sweep-lapsed-holds";

/**
 * How often the sweep runs. A minute is the worst case by which a hold whose own job was
 * lost stops holding its slot — precise release is what the per-hold job is for, and this
 * is what makes losing one survivable.
 */
export const SWEEP_INTERVAL_MS = 60 * 1000;

/** One scheduler for the whole deployment: the id is the key BullMQ upserts on. */
const SWEEP_SCHEDULER_ID = "lapsed-holds-sweep";

export type ExpireHoldJobData = { bookingId: string };

/** The sweep asks the same question of every listing, so it carries nothing. */
export type SweepJobData = Record<string, never>;

export type BookingExpiryJobData = ExpireHoldJobData | SweepJobData;

/**
 * A thin seam over the BullMQ queue, with the two halves of hold expiry that live in
 * Redis: a job per hold, scheduled for that hold's deadline, and a repeatable sweep behind
 * it. The third half is not here at all — `BookingRepository.create` expires this
 * listing's lapsed holds inside its own transaction.
 *
 * The sweep is what makes the queue disposable. A per-hold job lives only in Redis, which
 * this project runs without a volume, so a restart loses every one of them; without a
 * sweep a hold on a listing nobody books again would stay `PENDING_PAYMENT` forever —
 * listed as an active stay and blocking its slot through the `EXCLUDE` constraint, since
 * the lazy half only ever looks at the listing being booked.
 *
 * Nothing here is allowed to fail a request. The booking is already committed by the time
 * this is called, and the sweep releases what the queue never learned about, so a Redis
 * that is down costs precision rather than correctness.
 */
@Injectable()
export class BookingExpiryQueue implements OnApplicationBootstrap {
  private readonly logger = new Logger(BookingExpiryQueue.name);

  constructor(
    @InjectQueue(BOOKING_EXPIRY_QUEUE)
    private readonly queue: Queue<BookingExpiryJobData>,
  ) {}

  /**
   * Not awaited, and that is the point: a Redis that is slow or unreachable must not hold
   * the API's boot open. The same `void` treatment `main.ts` gives `bootstrap()`.
   */
  onApplicationBootstrap(): void {
    void this.registerSweep();
  }

  async scheduleExpiry(bookingId: string, runAt: Date): Promise<void> {
    try {
      await this.queue.add(
        EXPIRE_HOLD_JOB,
        { bookingId },
        {
          jobId: bookingId,
          delay: Math.max(0, runAt.getTime() - Date.now()),
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      // The transaction has already committed, so throwing here would answer a booking
      // that exists with a 500 and leave the caller without its id. The sweep releases
      // this hold within SWEEP_INTERVAL_MS of its deadline instead.
      this.logger.warn(
        `Could not schedule the expiry job for booking ${bookingId}, leaving it to the sweep: ${String(error)}`,
      );
    }
  }

  /**
   * Best effort: the job may have already run — the processor's update is idempotent — or
   * never have existed. Neither is a failure the caller should have to handle.
   */
  async cancelExpiry(bookingId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(bookingId);

      await job?.remove();
    } catch (error) {
      this.logger.warn(
        `Could not cancel the expiry job for booking ${bookingId}: ${String(error)}`,
      );
    }
  }

  private async registerSweep(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        SWEEP_SCHEDULER_ID,
        { every: SWEEP_INTERVAL_MS },
        {
          name: SWEEP_LAPSED_HOLDS_JOB,
          data: {},
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      );
    } catch (error) {
      // Logged rather than raised: the API serves every other route without a queue, and
      // the lazy half inside `create` still releases the holds of a listing being booked.
      this.logger.error(
        `Could not register the lapsed-hold sweep — holds will only be released by their own job and by the check inside create: ${String(error)}`,
      );
    }
  }
}
