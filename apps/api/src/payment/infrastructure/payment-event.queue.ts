import { InjectQueue } from "@nestjs/bullmq";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { Queue } from "bullmq";
import { PaymentEventJobs } from "../application/ports/payment-event-jobs";

export const PAYMENT_EVENT_QUEUE = "payment-event";

/** Handles the one recorded event it names. */
export const PROCESS_EVENT_JOB = "process-event";

/** Re-queues the events a lost job left unprocessed, on a schedule. */
export const SWEEP_EVENTS_JOB = "sweep-events";

/** Deletes the processed events past their retention, once a day. */
export const PRUNE_EVENTS_JOB = "prune-events";

/** How often the sweep runs — the worst delay of an event whose own job was lost. */
export const EVENT_SWEEP_INTERVAL_MS = 60 * 1000;

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const SWEEP_SCHEDULER_ID = "payment-events-sweep";

const PRUNE_SCHEDULER_ID = "payment-events-prune";

export type ProcessEventJobData = { eventId: string };

/** Both schedules ask the same question of every event, so they carry nothing. */
export type SweepEventsJobData = Record<string, never>;

export type PaymentEventJobData = ProcessEventJobData | SweepEventsJobData;

/**
 * The worker's half of the webhook inbox, the adapter behind `PaymentEventJobs`. The event
 * is in the database before it is queued, so a job that never reaches Redis is found by the
 * sweep — nothing here fails the webhook.
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
    void this.registerSchedule(
      SWEEP_SCHEDULER_ID,
      SWEEP_EVENTS_JOB,
      EVENT_SWEEP_INTERVAL_MS,
    );
    void this.registerSchedule(
      PRUNE_SCHEDULER_ID,
      PRUNE_EVENTS_JOB,
      PRUNE_INTERVAL_MS,
    );
  }

  /**
   * One job per event: a second delivery, or the sweep, adding it while it waits is the
   * same job. A failure is retried with a growing pause — what Stripe's redelivery used to
   * do — and the sweep picks up an event whose attempts ran out, until the dispatcher sets
   * it aside (`MAX_EVENT_ATTEMPTS`).
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
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not queue payment event ${eventId}, leaving it to the sweep: ${String(error)}`,
      );
    }
  }

  private async registerSchedule(
    schedulerId: string,
    name: typeof SWEEP_EVENTS_JOB | typeof PRUNE_EVENTS_JOB,
    every: number,
  ): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        schedulerId,
        { every },
        {
          name,
          data: {},
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      );
    } catch (error) {
      this.logger.error(
        `Could not register the ${name} schedule — events will only be handled by their own job: ${String(error)}`,
      );
    }
  }
}
