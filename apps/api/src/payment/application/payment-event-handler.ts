import type { PaymentEvent } from "./ports/payment-gateway";

/**
 * What a module does with the provider's news: it acts on the kinds it owns and returns for
 * the rest. Idempotent, and throws to have the delivery handled again.
 */
export interface PaymentEventHandler {
  handle(event: PaymentEvent): Promise<void>;
}
