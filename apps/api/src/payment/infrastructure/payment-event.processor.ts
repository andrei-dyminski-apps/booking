import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { PaymentEventDispatcher } from "../application/payment-event-dispatcher";
import {
  PAYMENT_EVENT_QUEUE,
  PROCESS_EVENT_JOB,
  type PaymentEventJobData,
  type ProcessEventJobData,
} from "./payment-event.queue";

/**
 * The two jobs of the webhook inbox: `process-event` handles the event it names, and the
 * repeatable `sweep-events` re-queues whatever a lost job left unprocessed. A failure is
 * thrown, so BullMQ tries the event again.
 */
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

    const requeued = await this.paymentEventDispatcher.requeueStale();

    if (requeued > 0) {
      this.logger.warn(
        `Re-queued ${String(requeued)} unprocessed payment event(s)`,
      );
    }
  }
}

function isProcessEventJob(
  job: Job<PaymentEventJobData>,
): job is Job<ProcessEventJobData> {
  return job.name === PROCESS_EVENT_JOB;
}
