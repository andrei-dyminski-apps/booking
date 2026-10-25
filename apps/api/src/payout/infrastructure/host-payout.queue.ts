import { InjectQueue } from "@nestjs/bullmq";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { Queue } from "bullmq";
import { PayoutJobs } from "../application/ports/payout-jobs";

export const HOST_PAYOUT_QUEUE = "host-payout";

export const PAY_OUT_JOB = "pay-out";

export const PAY_HOST_JOB = "pay-host";

export const SWEEP_DUE_PAYOUTS_JOB = "sweep-due-payouts";

/** The worst delay of a payout whose job was lost; a host is paid by the day. */
export const PAYOUT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const SWEEP_SCHEDULER_ID = "due-payouts-sweep";

export type PayOutJobData = { bookingId: string };

export type PayHostJobData = { hostId: string };

export type SweepPayoutsJobData = Record<string, never>;

export type HostPayoutJobData =
  | PayOutJobData
  | PayHostJobData
  | SweepPayoutsJobData;

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
          // A passing failure would otherwise wait an hour for the sweep.
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

  /** One job per host, so a second request noticing the same news is the same job. */
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
