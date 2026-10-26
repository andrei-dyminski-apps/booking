import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { logJobFailure, unknownJob } from "../../common/job-failure";
import { PayoutService } from "../application/payout.service";
import {
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

  constructor(private readonly payoutService: PayoutService) {
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
      default:
        unknownJob(name);
    }
  }

  @OnWorkerEvent("failed")
  onFailed(job: HostPayoutJob | undefined, error: Error): void {
    logJobFailure(this.logger, job, error);
  }
}
