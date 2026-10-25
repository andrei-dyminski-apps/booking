import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { PayoutService } from "../application/payout.service";
import {
  HOST_PAYOUT_QUEUE,
  PAY_HOST_JOB,
  PAY_OUT_JOB,
  type HostPayoutJobData,
  type PayHostJobData,
  type PayOutJobData,
} from "./host-payout.queue";

/**
 * The three payout jobs over one queue: `pay-out` pays the stay it names when its payout
 * falls due, `pay-host` pays what waited for a host whose account has just been enabled,
 * and the repeatable `sweep-due-payouts` pays whatever the other two missed.
 * Both go through `PayoutService`, where a payout is idempotent — a job that runs twice, or
 * after the sweep paid the stay, sends nothing more.
 */
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
}

function isPayOutJob(job: Job<HostPayoutJobData>): job is Job<PayOutJobData> {
  return job.name === PAY_OUT_JOB;
}

function isPayHostJob(job: Job<HostPayoutJobData>): job is Job<PayHostJobData> {
  return job.name === PAY_HOST_JOB;
}
