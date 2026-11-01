import { InjectQueue } from "@nestjs/bullmq";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { type Job, Queue } from "bullmq";
import { DISPOSABLE, registerSweep } from "../../common/job-options";
import { PaymentEventJobs } from "../application/ports/payment-event-jobs";

export const PAYMENT_EVENT_QUEUE = "payment-event";

export const PROCESS_EVENT_JOB = "process-event";

export const SWEEP_EVENTS_JOB = "sweep-events";

export const PRUNE_EVENTS_JOB = "prune-events";

/** The worst delay of an event whose own job was lost. */
export const EVENT_SWEEP_INTERVAL_MS = 60 * 1000;

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const SWEEP_SCHEDULER_ID = "payment-events-sweep";

const PRUNE_SCHEDULER_ID = "payment-events-prune";

export type ProcessEventJobData = { eventId: string };

export type SweepEventsJobData = Record<string, never>;

export type PaymentEventJobData = ProcessEventJobData | SweepEventsJobData;

/**
 * What the worker is handed: the name decides the data. The queue stays typed by the data,
 * since BullMQ types a scheduler's id as a job name; its sweeps take their names from here.
 */
export type PaymentEventJob =
  | Job<ProcessEventJobData, void, typeof PROCESS_EVENT_JOB>
  | Job<SweepEventsJobData, void, typeof SWEEP_EVENTS_JOB>
  | Job<SweepEventsJobData, void, typeof PRUNE_EVENTS_JOB>;

/**
 * The event is in the database before it is queued, so a job that never reaches Redis is
 * found by the sweep — nothing here fails the webhook.
 */
@Injectable()
export class PaymentEventQueue
  extends PaymentEventJobs
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(PaymentEventQueue.name);

  constructor(
    @InjectQueue(PAYMENT_EVENT_QUEUE)
    private readonly queue: Queue<PaymentEventJobData>,
  ) {
    super();
  }

  /** Not awaited: a Redis that is slow must not hold the API's boot open. */
  onApplicationBootstrap(): void {
    void registerSweep<PaymentEventJob["name"]>(
      this.queue,
      this.logger,
      {
        schedulerId: SWEEP_SCHEDULER_ID,
        name: SWEEP_EVENTS_JOB,
        every: EVENT_SWEEP_INTERVAL_MS,
      },
      `Could not register the ${SWEEP_EVENTS_JOB} schedule — events will only be handled by their own job`,
    );
    void registerSweep<PaymentEventJob["name"]>(
      this.queue,
      this.logger,
      {
        schedulerId: PRUNE_SCHEDULER_ID,
        name: PRUNE_EVENTS_JOB,
        every: PRUNE_INTERVAL_MS,
      },
      `Could not register the ${PRUNE_EVENTS_JOB} schedule — processed events will pile up`,
    );
  }

  /**
   * One job per event, so a redelivery or the sweep adding it while it waits is the same
   * job. The sweep picks up an event whose attempts ran out, until `MAX_EVENT_ATTEMPTS`.
   */
  async process(eventId: string): Promise<void> {
    try {
      await this.queue.add(
        PROCESS_EVENT_JOB,
        { eventId },
        {
          jobId: `event-${eventId}`,
          attempts: 8,
          backoff: { type: "exponential", delay: 5_000 },
          ...DISPOSABLE,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not queue payment event ${eventId}, leaving it to the sweep: ${String(error)}`,
      );
    }
  }
}
