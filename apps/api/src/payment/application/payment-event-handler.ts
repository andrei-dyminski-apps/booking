import { RetryLaterError } from "../../common/retry-later.error";
import type { PaymentEvent } from "./ports/payment-gateway";

/**
 * What a module does with the provider's news: it acts on the kinds it owns and returns for
 * the rest. Idempotent, and throws to have the delivery handled again.
 */
export interface PaymentEventHandler {
  handle(event: PaymentEvent): Promise<void>;
}

/**
 * Thrown by a handler that could not start because another run holds the stay — a lease
 * that runs out on its own. The dispatcher retries it without counting a failure, so
 * waiting on a cancellation never brings an event closer to being set aside.
 */
export class PaymentEventBusyError extends RetryLaterError {
  constructor(reason: string) {
    super(reason);
    this.name = "PaymentEventBusyError";
  }
}
