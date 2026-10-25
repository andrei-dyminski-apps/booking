import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { describeJobFailure } from "../../common/job-failure";
import { PayoutService } from "../application/payout.service";
import {
  HOST_PAYOUT_QUEUE,
  PAY_HOST_JOB,
  PAY_OUT_JOB,
  type HostPayoutJobData,
  type PayHostJobData,
  type PayOutJobData,
} from "./host-payout.queue";

/** A payout is idempotent in `PayoutService`, so a job that runs twice sends nothing more. */
@Processor(HOST_PAYOUT_QUEUE)
export class HostPayoutProcessor extends WorkerHost {
  private readonly logger = new Logger(HostPayoutProcessor.name);

  constructor(private readonly payoutService: PayoutService) {
    super();
  }

  async process(job: Job<HostPayoutJobData>): Promise<void> {
    if (isPayOutJob(job)) {
      await this.payoutService.payOut(job.data.bookingId);

      return;
    }

    if (isPayHostJob(job)) {
      await this.payoutService.payDuePayouts(job.data.hostId);

      return;
    }

    const paid = await this.payoutService.payDuePayouts();

    if (paid > 0) this.logger.log(`Paid ${String(paid)} due payout(s)`);
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job<HostPayoutJobData> | undefined, error: Error): void {
    this.logger.error(describeJobFailure(job, error), error.stack);
  }
}

function isPayOutJob(job: Job<HostPayoutJobData>): job is Job<PayOutJobData> {
  return job.name === PAY_OUT_JOB;
}

function isPayHostJob(job: Job<HostPayoutJobData>): job is Job<PayHostJobData> {
  return job.name === PAY_HOST_JOB;
}
