import { InjectQueue } from "@nestjs/bullmq";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { Queue } from "bullmq";
import { PayoutJobs } from "../application/ports/payout-jobs";

export const HOST_PAYOUT_QUEUE = "host-payout";

/** Pays the host of the one stay it names, and runs when that stay's payout falls due. */
export const PAY_OUT_JOB = "pay-out";

/** Pays every due stay of one host, and runs when their account becomes able to be paid. */
export const PAY_HOST_JOB = "pay-host";

/** Pays every due stay there is, and runs on a schedule. */
export const SWEEP_DUE_PAYOUTS_JOB = "sweep-due-payouts";

/**
 * How often the sweep runs. An hour is the worst case by which a payout whose own job was
 * lost — or whose host finished onboarding after it fell due — goes out late; a host is
 * paid by the day, so nothing finer buys anything.
 */
export const PAYOUT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** One scheduler for the whole deployment: the id is the key BullMQ upserts on. */
const SWEEP_SCHEDULER_ID = "due-payouts-sweep";

export type PayOutJobData = { bookingId: string };

export type PayHostJobData = { hostId: string };

/** The sweep asks the same question of every stay, so it carries nothing. */
export type SweepPayoutsJobData = Record<string, never>;

export type HostPayoutJobData =
  | PayOutJobData
  | PayHostJobData
  | SweepPayoutsJobData;

/**
 * The seam over the payout queue and the adapter behind `PayoutJobs`, built the way
 * `BookingExpiryQueue` is and for the same reasons: a job per stay at the moment its payout falls due, and a repeatable sweep behind
 * it that pays whatever the jobs missed — a Redis restart, a host who could not be paid
 * when their job ran because their onboarding was not finished.
 *
 * Nothing here fails a request: by the time a payout is scheduled the stay is already
 * confirmed, and the sweep pays what the queue never heard about.
 */
@Injectable()
export class HostPayoutQueue
  extends PayoutJobs
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(HostPayoutQueue.name);

  constructor(
    @InjectQueue(HOST_PAYOUT_QUEUE)
    private readonly queue: Queue<HostPayoutJobData>,
  ) {
    super();
  }

  /** Not awaited: a Redis that is slow must not hold the API's boot open. */
  onApplicationBootstrap(): void {
    void this.registerSweep();
  }

  async schedulePayout(bookingId: string, runAt: Date): Promise<void> {
    try {
      await this.queue.add(
        PAY_OUT_JOB,
        { bookingId },
        {
          jobId: `payout-${bookingId}`,
          delay: Math.max(0, runAt.getTime() - Date.now()),
          // A transfer can fail for reasons that pass — the provider unreachable for a
          // moment — and the sweep would only retry it an hour later.
          attempts: 3,
          backoff: { type: "exponential", delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not schedule the payout of booking ${bookingId}, leaving it to the sweep: ${String(error)}`,
      );
    }
  }

  /**
   * The due stays of a host whose account has just become able to receive transfers, paid
   * by the worker rather than by whoever noticed — a request that would otherwise wait on
   * a transfer per stay. One job per host at a time: a second request noticing the same
   * news while the first job waits is the same job.
   */
  async schedulePayoutsOf(hostId: string): Promise<void> {
    try {
      await this.queue.add(
        PAY_HOST_JOB,
        { hostId },
        {
          jobId: `host-${hostId}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not schedule the payouts of host ${hostId}, leaving them to the sweep: ${String(error)}`,
      );
    }
  }

  private async registerSweep(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        SWEEP_SCHEDULER_ID,
        { every: PAYOUT_SWEEP_INTERVAL_MS },
        {
          name: SWEEP_DUE_PAYOUTS_JOB,
          data: {},
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      );
    } catch (error) {
      this.logger.error(
        `Could not register the payout sweep — stays will only be paid by their own job: ${String(error)}`,
      );
    }
  }
}
