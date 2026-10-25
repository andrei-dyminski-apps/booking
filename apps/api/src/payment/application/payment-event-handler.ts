import type { PaymentEvent } from "./ports/payment-gateway";

/**
 * What a domain does with the provider's news. The dispatcher hands every delivery to every
 * handler, and a handler acts on the kinds it owns and returns for the rest — so `payment`
 * knows no domain, and a domain registers itself instead of being named here.
 *
 * A handler is idempotent on its own, and throws to have the delivery repeated: the
 * dispatcher records the event only after every handler returned.
 */
export interface PaymentEventHandler {
  handle(event: PaymentEvent): Promise<void>;
}
