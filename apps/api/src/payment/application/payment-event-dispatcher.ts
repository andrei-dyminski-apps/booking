import { Injectable, Logger } from "@nestjs/common";
import { NotificationType } from "@repo/contracts";
import { subDays, subMinutes } from "date-fns";
import { errorText } from "../../common/job-failure";
import { NotificationService } from "../../notification/notification.service";
import { PaymentEventRepository } from "../infrastructure/payment-event.repository";
import type { PaymentEventHandler } from "./payment-event-handler";
import { PaymentEventJobs } from "./ports/payment-event-jobs";
import type { PaymentEvent } from "./ports/payment-gateway";

/**
 * Three rounds of the job's own eight attempts, about half an hour: an event that fails the
 * same way every time stops here instead of being retried for good.
 */
export const MAX_EVENT_ATTEMPTS = 24;

/** Well past the three days a provider redelivers for. */
export const EVENT_RETENTION_DAYS = 90;

export const SWEEP_BATCH = 100;

/**
 * The webhook inbox. The webhook records and queues an event and answers at once — Stripe
 * expects a `2xx` within seconds, and the work behind an event calls Stripe and waits for
 * leases. The worker stamps an event processed only after every handler returned, so a run
 * that failed half way is finished by the next one.
 *
 * Modules register their handlers in `onModuleInit`, so `payment` imports neither `booking`
 * nor `payout`. Each handler writes only its own columns, so their order does not matter.
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

  /** Throws only when the event could not be recorded: the webhook's `500`, a redelivery. */
  async receive(event: PaymentEvent): Promise<void> {
    await this.paymentEventRepository.record(event);
    await this.paymentEventJobs.process(event.eventId);
  }

  /** Throws to have the job retry, unless this failure set the event aside. */
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
   * Re-queues what a lost job left pending. The minute keeps it off the events whose own job
   * is still on its way.
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

  pruneProcessed(now = new Date()): Promise<number> {
    return this.paymentEventRepository.pruneProcessed(
      subDays(now, EVENT_RETENTION_DAYS),
    );
  }

  /** Whether this failed run set the event aside. A failure to count it leaves it to retry. */
  private async setAsideAfter(
    eventId: string,
    error: unknown,
  ): Promise<boolean> {
    const message = errorText(error);
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
