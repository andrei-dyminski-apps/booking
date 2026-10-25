import { Injectable } from "@nestjs/common";
import { PaymentEventQueue } from "../infrastructure/payment-event.queue";
import { PaymentEventRepository } from "../infrastructure/payment-event.repository";
import type { PaymentEventHandler } from "./payment-event-handler";
import type { PaymentEvent } from "./ports/payment-gateway";

/**
 * The webhook inbox. `receive` is the webhook's half: the verified event is recorded and
 * queued, and the provider is answered at once — Stripe expects a `2xx` within seconds, and
 * the work behind an event calls Stripe and waits for leases. `process` is the worker's
 * half: every registered handler runs, and the event is stamped processed only after all of
 * them returned, so a run that failed half way is retried and finished by the next one.
 *
 * The handlers are not declared here: a module registers its own in `onModuleInit`, which
 * is how the webhooks reach `booking` and `payout` while `payment` imports neither. They
 * run one after another and must not rely on the order; each writes only its own columns.
 */
@Injectable()
export class PaymentEventDispatcher {
  private readonly handlers: PaymentEventHandler[] = [];

  constructor(
    private readonly paymentEventRepository: PaymentEventRepository,
    private readonly paymentEventQueue: PaymentEventQueue,
  ) {}

  register(handler: PaymentEventHandler): void {
    this.handlers.push(handler);
  }

  /** Throws only when the event could not be recorded — the webhook's `500`, a redelivery. */
  async receive(event: PaymentEvent): Promise<void> {
    await this.paymentEventRepository.record(event);
    await this.paymentEventQueue.process(event.eventId);
  }

  async process(eventId: string): Promise<void> {
    const event = await this.paymentEventRepository.findUnprocessed(eventId);

    if (event === null) return;

    for (const handler of this.handlers) {
      await handler.handle(event);
    }

    await this.paymentEventRepository.markProcessed(eventId);
  }

  /**
   * The sweep: events older than a minute and still unprocessed — a job lost with Redis, or
   * one whose attempts ran out — go back on the queue. The minute keeps it off the events
   * whose own job is still on its way.
   */
  async requeueStale(now = new Date()): Promise<number> {
    const stale = await this.paymentEventRepository.findStale(
      new Date(now.getTime() - STALE_AFTER_MS),
    );

    for (const eventId of stale) {
      await this.paymentEventQueue.process(eventId);
    }

    return stale.length;
  }
}

const STALE_AFTER_MS = 60_000;
