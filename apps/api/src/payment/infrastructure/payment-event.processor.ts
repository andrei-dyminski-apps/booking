import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { logJobFailure, unknownJob } from "../../common/job-failure";
import { PaymentEventDispatcher } from "../application/payment-event-dispatcher";
import {
  PAYMENT_EVENT_QUEUE,
  PROCESS_EVENT_JOB,
  PRUNE_EVENTS_JOB,
  SWEEP_EVENTS_JOB,
  type PaymentEventJob,
} from "./payment-event.queue";

const WORKER_CONCURRENCY = 4;

/**
 * The inbox's jobs: one event, the sweep, and the daily prune. Several events at a time, so
 * one waiting on a lease or on Stripe does not hold the rest behind it — the handlers take
 * the per-booking leases and write conditionally, as they must across instances anyway.
 */
@Processor(PAYMENT_EVENT_QUEUE, { concurrency: WORKER_CONCURRENCY })
export class PaymentEventProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentEventProcessor.name);

  constructor(private readonly paymentEventDispatcher: PaymentEventDispatcher) {
    super();
  }

  async process(job: PaymentEventJob): Promise<void> {
    const { name, data } = job;

    switch (name) {
      case PROCESS_EVENT_JOB:
        await this.paymentEventDispatcher.process(data.eventId);

        return;
      case SWEEP_EVENTS_JOB: {
        const requeued = await this.paymentEventDispatcher.requeueStale();

        if (requeued > 0) {
          this.logger.warn(
            `Re-queued ${String(requeued)} unprocessed payment event(s)`,
          );
        }

        return;
      }
      case PRUNE_EVENTS_JOB: {
        const pruned = await this.paymentEventDispatcher.pruneProcessed();

        if (pruned > 0) {
          this.logger.log(
            `Pruned ${String(pruned)} processed payment event(s)`,
          );
        }

        return;
      }
      default:
        unknownJob(name);
    }
  }

  @OnWorkerEvent("failed")
  onFailed(job: PaymentEventJob | undefined, error: Error): void {
    logJobFailure(this.logger, job, error);
  }
}
