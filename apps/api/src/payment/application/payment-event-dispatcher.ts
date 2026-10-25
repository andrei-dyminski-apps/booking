import { Injectable, Logger } from "@nestjs/common";
import { NotificationType } from "@repo/contracts";
import { subDays, subMinutes } from "date-fns";
import { NotificationService } from "../../notification/notification.service";
import { PaymentEventRepository } from "../infrastructure/payment-event.repository";
import type { PaymentEventHandler } from "./payment-event-handler";
import { PaymentEventJobs } from "./ports/payment-event-jobs";
import type { PaymentEvent } from "./ports/payment-gateway";

/**
 * How many failed runs set an event aside: three rounds of the job's own eight attempts,
 * about half an hour of a provider or a database that is away. An event that fails the
 * same way every time — a handler's bug, a refund the provider keeps refusing, a payload
 * the schema no longer reads — stops there instead of being retried for good, and the
 * admins are told.
 */
export const MAX_EVENT_ATTEMPTS = 24;

/** How long a processed event is kept: well past the three days a provider redelivers for. */
export const EVENT_RETENTION_DAYS = 90;

/** At most this many events per sweep; the sweep a minute later reads the rest. */
export const SWEEP_BATCH = 100;

/** What `last_error` and a notice keep of an error. */
const MAX_ERROR_LENGTH = 1_000;

/**
 * The webhook inbox. `receive` is the webhook's half: the verified event is recorded and
 * queued, and the provider is answered at once — Stripe expects a `2xx` within seconds, and
 * the work behind an event calls Stripe and waits for leases. `process` is the worker's
 * half: every registered handler runs, and the event is stamped processed only after all of
 * them returned, so a run that failed half way is retried and finished by the next one. A
 * failed run is counted on the row, and `MAX_EVENT_ATTEMPTS` of them set the event aside.
 *
 * The handlers are not declared here: a module registers its own in `onModuleInit`, which
 * is how the webhooks reach `booking` and `payout` while `payment` imports neither. They
 * run one after another and must not rely on the order; each writes only its own columns.
 */
@Injectable()
export class PaymentEventDispatcher {
  private readonly logger = new Logger(PaymentEventDispatcher.name);
  private readonly handlers: PaymentEventHandler[] = [];

  constructor(
    private readonly paymentEventRepository: PaymentEventRepository,
    private readonly paymentEventJobs: PaymentEventJobs,
    private readonly notificationService: NotificationService,
  ) {}

  register(handler: PaymentEventHandler): void {
    this.handlers.push(handler);
  }

  /** Throws only when the event could not be recorded — the webhook's `500`, a redelivery. */
  async receive(event: PaymentEvent): Promise<void> {
    await this.paymentEventRepository.record(event);
    await this.paymentEventJobs.process(event.eventId);
  }

  /**
   * Throws to have the job try again — unless this failure was the one that set the event
   * aside, which ends its retries: the admins are told and the job completes.
   */
  async process(eventId: string): Promise<void> {
    try {
      const event = await this.paymentEventRepository.findUnprocessed(eventId);

      if (event === null) return;

      for (const handler of this.handlers) {
        await handler.handle(event);
      }
    } catch (error) {
      if (await this.setAsideAfter(eventId, error)) return;

      throw error;
    }

    await this.paymentEventRepository.markProcessed(eventId);
  }

  /**
   * The sweep: events older than a minute and still pending — a job lost with Redis, or
   * one whose attempts ran out — go back on the queue, the oldest first. The minute keeps it
   * off the events whose own job is still on its way.
   */
  async requeueStale(now = new Date()): Promise<number> {
    const stale = await this.paymentEventRepository.findStale(
      subMinutes(now, 1),
      SWEEP_BATCH,
    );

    for (const eventId of stale) {
      await this.paymentEventJobs.process(eventId);
    }

    return stale.length;
  }

  /** The daily prune: processed events past `EVENT_RETENTION_DAYS`. */
  pruneProcessed(now = new Date()): Promise<number> {
    return this.paymentEventRepository.pruneProcessed(
      subDays(now, EVENT_RETENTION_DAYS),
    );
  }

  /**
   * Counts the failed run, and answers whether it set the event aside. A failure to count
   * it is logged and leaves the event to be retried — the original error is what the job
   * reports.
   */
  private async setAsideAfter(
    eventId: string,
    error: unknown,
  ): Promise<boolean> {
    const message = String(error).slice(0, MAX_ERROR_LENGTH);
    let failure: Awaited<ReturnType<PaymentEventRepository["recordFailure"]>>;

    try {
      failure = await this.paymentEventRepository.recordFailure(
        eventId,
        message,
        MAX_EVENT_ATTEMPTS,
      );
    } catch (recordError) {
      this.logger.error(
        `Could not count the failure of payment event ${eventId}: ${String(recordError)}`,
      );

      return false;
    }

    if (failure === null || !failure.setAside) return false;

    this.logger.error(
      `Payment event ${eventId} (${failure.type}) failed ${String(failure.attempts)} times and is set aside: ${message}`,
    );
    await this.notificationService.notifyAdmins({
      type: NotificationType.PAYMENT_EVENT_FAILED,
      data: { eventId, eventType: failure.type, error: message },
    });

    return true;
  }
}
