import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { describeJobFailure } from "../../common/job-failure";
import { PaymentEventDispatcher } from "../application/payment-event-dispatcher";
import {
  PAYMENT_EVENT_QUEUE,
  PROCESS_EVENT_JOB,
  PRUNE_EVENTS_JOB,
  type PaymentEventJobData,
  type ProcessEventJobData,
} from "./payment-event.queue";

/** The inbox's jobs: one event, the sweep, and the daily prune. */
@Processor(PAYMENT_EVENT_QUEUE)
export class PaymentEventProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentEventProcessor.name);

  constructor(private readonly paymentEventDispatcher: PaymentEventDispatcher) {
    super();
  }

  async process(job: Job<PaymentEventJobData>): Promise<void> {
    if (isProcessEventJob(job)) {
      await this.paymentEventDispatcher.process(job.data.eventId);

      return;
    }

    if (job.name === PRUNE_EVENTS_JOB) {
      const pruned = await this.paymentEventDispatcher.pruneProcessed();

      if (pruned > 0) {
        this.logger.log(`Pruned ${String(pruned)} processed payment event(s)`);
      }

      return;
    }

    const requeued = await this.paymentEventDispatcher.requeueStale();

    if (requeued > 0) {
      this.logger.warn(
        `Re-queued ${String(requeued)} unprocessed payment event(s)`,
      );
    }
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job<PaymentEventJobData> | undefined, error: Error): void {
    this.logger.error(describeJobFailure(job, error), error.stack);
  }
}

function isProcessEventJob(
  job: Job<PaymentEventJobData>,
): job is Job<ProcessEventJobData> {
  return job.name === PROCESS_EVENT_JOB;
}
