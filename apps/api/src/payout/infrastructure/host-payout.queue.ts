import { InjectQueue } from "@nestjs/bullmq";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { type Job, Queue } from "bullmq";
import { DISPOSABLE, registerSweep } from "../../common/job-options";
import { RedisOutage } from "../../common/redis-outage";
import {
  describeClose,
  PayoutJobs,
  type AccountClose,
} from "../application/ports/payout-jobs";

export const HOST_PAYOUT_QUEUE = "host-payout";

export const PAY_OUT_JOB = "pay-out";

export const PAY_HOST_JOB = "pay-host";

export const SWEEP_DUE_PAYOUTS_JOB = "sweep-due-payouts";

export const CLOSE_ACCOUNT_JOB = "close-account";

/** The worst delay of a payout whose job was lost; a host is paid by the day. */
export const PAYOUT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const SWEEP_SCHEDULER_ID = "due-payouts-sweep";

export type PayOutJobData = { bookingId: string };

export type PayHostJobData = { hostId: string };

export type SweepPayoutsJobData = Record<string, never>;

export type CloseAccountJobData = AccountClose;

export type HostPayoutJobData =
  PayOutJobData | PayHostJobData | SweepPayoutsJobData | CloseAccountJobData;

/** What the worker is handed: the name decides the data, as in `PaymentEventJob`. */
export type HostPayoutJob =
  | Job<PayOutJobData, void, typeof PAY_OUT_JOB>
  | Job<PayHostJobData, void, typeof PAY_HOST_JOB>
  | Job<SweepPayoutsJobData, void, typeof SWEEP_DUE_PAYOUTS_JOB>
  | Job<CloseAccountJobData, void, typeof CLOSE_ACCOUNT_JOB>;

/**
 * A job per stay at its due time and an hourly sweep, as `BookingExpiryQueue` has. Nothing
 * here fails a request: the stay is confirmed already, and the sweep pays what was missed.
 */
@Injectable()
export class HostPayoutQueue
  extends PayoutJobs
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(HostPayoutQueue.name);

  private readonly redisOutage = new RedisOutage(
    this.logger,
    `The ${HOST_PAYOUT_QUEUE} queue`,
  );

  constructor(
    @InjectQueue(HOST_PAYOUT_QUEUE)
    private readonly queue: Queue<HostPayoutJobData>,
  ) {
    super();
    queue.on("error", (error) => {
      this.redisOutage.report(error, queue.getBackend());
    });
  }

  /** Not awaited: a Redis that is slow must not hold the API's boot open. */
  onApplicationBootstrap(): void {
    void registerSweep<HostPayoutJob["name"]>(
      this.queue,
      this.logger,
      {
        schedulerId: SWEEP_SCHEDULER_ID,
        name: SWEEP_DUE_PAYOUTS_JOB,
        every: PAYOUT_SWEEP_INTERVAL_MS,
      },
      "Could not register the payout sweep — stays will only be paid by their own job",
    );
  }

  async schedulePayout(bookingId: string, runAt: Date): Promise<void> {
    try {
      await this.queue.add(
        PAY_OUT_JOB,
        { bookingId },
        {
          jobId: `payout-${bookingId}`,
          delay: Math.max(0, runAt.getTime() - Date.now()),
          // A passing failure would otherwise wait an hour for the sweep.
          attempts: 3,
          backoff: { type: "exponential", delay: 60_000 },
          ...DISPOSABLE,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not schedule the payout of booking ${bookingId}, leaving it to the sweep: ${String(error)}`,
      );
    }
  }

  /** One job per host, so a second request noticing the same news is the same job. */
  async schedulePayoutsOf(hostId: string): Promise<void> {
    try {
      await this.queue.add(
        PAY_HOST_JOB,
        { hostId },
        {
          jobId: `host-${hostId}`,
          ...DISPOSABLE,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not schedule the payouts of host ${hostId}, leaving them to the sweep: ${String(error)}`,
      );
    }
  }

  /**
   * No sweep stands behind it — no row names an account nobody holds — so the job retries
   * for longer than a payout's, and an account it could not queue is logged for a person.
   */
  async scheduleAccountClose(close: AccountClose): Promise<void> {
    try {
      await this.queue.add(CLOSE_ACCOUNT_JOB, close, {
        jobId: `close-account-${close.accountId}`,
        attempts: 6,
        backoff: { type: "exponential", delay: 30_000 },
        ...DISPOSABLE,
      });
    } catch (error) {
      this.logger.error(
        `Could not queue the close of ${describeClose(close)} — close it in the Dashboard: ${String(error)}`,
      );
    }
  }
}
