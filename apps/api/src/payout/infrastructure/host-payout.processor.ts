import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { logJobFailure, unknownJob } from "../../common/job-failure";
import { RedisOutage } from "../../common/redis-outage";
import { HostAccountService } from "../application/host-account.service";
import { PayoutService } from "../application/payout.service";
import { describeClose } from "../application/ports/payout-jobs";
import {
  CLOSE_ACCOUNT_JOB,
  HOST_PAYOUT_QUEUE,
  PAY_HOST_JOB,
  PAY_OUT_JOB,
  SWEEP_DUE_PAYOUTS_JOB,
  type HostPayoutJob,
} from "./host-payout.queue";

const WORKER_CONCURRENCY = 4;

/**
 * A payout is idempotent in `PayoutService`, so a job that runs twice sends nothing more —
 * which is also what lets several run at once, and a stay's own job run beside the hourly
 * sweep instead of waiting out a hundred stays' worth of Stripe calls.
 */
@Processor(HOST_PAYOUT_QUEUE, { concurrency: WORKER_CONCURRENCY })
export class HostPayoutProcessor extends WorkerHost {
  private readonly logger = new Logger(HostPayoutProcessor.name);

  private readonly redisOutage = new RedisOutage(
    this.logger,
    `The ${HOST_PAYOUT_QUEUE} worker`,
  );

  constructor(
    private readonly payoutService: PayoutService,
    private readonly hostAccountService: HostAccountService,
  ) {
    super();
  }

  async process(job: HostPayoutJob): Promise<void> {
    const { name, data } = job;

    switch (name) {
      case PAY_OUT_JOB:
        await this.payoutService.payOut(data.bookingId);

        return;
      case PAY_HOST_JOB:
        await this.payoutService.payDuePayouts(data.hostId);

        return;
      case SWEEP_DUE_PAYOUTS_JOB: {
        const paid = await this.payoutService.payDuePayouts();

        if (paid > 0) this.logger.log(`Paid ${String(paid)} due payout(s)`);

        return;
      }
      case CLOSE_ACCOUNT_JOB:
        await this.hostAccountService.closeAccount(data);

        return;
      default:
        unknownJob(name);
    }
  }

  @OnWorkerEvent("failed")
  onFailed(job: HostPayoutJob | undefined, error: Error): void {
    logJobFailure(this.logger, job, error);

    // No row names an account nobody holds, and the job is removed once it fails for good:
    // this line is all a person has to find the account by.
    if (
      job?.name === CLOSE_ACCOUNT_JOB &&
      job.attemptsMade >= (job.opts.attempts ?? 1)
    ) {
      this.logger.error(
        `Gave up closing ${describeClose(job.data)} — close it in the Dashboard`,
      );
    }
  }

  /** Registered with the worker as it is created, so not one error reaches stderr. */
  @OnWorkerEvent("error")
  onError(error: Error): void {
    this.redisOutage.report(error, this.worker.getBackend());
  }
}
