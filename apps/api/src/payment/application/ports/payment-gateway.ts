/**
 * The port the guest's payments go through — a seam behind a token because it is an
 * external service the tests fake. It speaks the contract's money, euros to the cent; only
 * the adapter counts cents. An abstract class, so the class itself is the DI token.
 */
export abstract class PaymentGateway {
  /** Opens the payment of one hold, or answers the one already opened for it. */
  abstract open(bookingId: string, amount: number): Promise<OpenedPayment>;

  /**
   * Withdraws a payment whose hold lapsed or was cancelled. One already withdrawn or
   * completed is no failure; a completed one reaches the webhook, which refunds it.
   */
  abstract cancel(paymentId: string): Promise<void>;

  /**
   * Gives `amount` of a completed payment back, once per `key` — for good, not only for the
   * provider's 24 hours of idempotency: the adapter looks up a refund already sent under the
   * key before it sends one. Answers what the refund named by `key` gave back, which is
   * `amount` unless an earlier attempt sent it with another, and 0 for a payment already
   * refunded in full — nothing of it was left to give back.
   */
  abstract refund(
    paymentId: string,
    amount: number,
    key: string,
  ): Promise<number>;

  /**
   * How much of a completed payment has been given back so far, as the provider knows it —
   * a refund from its dashboard included, whose webhook may still be on its way.
   */
  abstract refundedSoFar(paymentId: string): Promise<number>;

  /**
   * Reads one webhook delivery, the signature over the raw body first. Throws
   * `InvalidPaymentEventError` for anything not signed by the provider.
   */
  abstract readEvent(payload: Buffer, signature: string): PaymentEvent;
}

export type OpenedPayment = {
  id: string;
  /** What the browser confirms the payment with; see `bookingPaymentSchema`. */
  clientSecret: string;
};

/**
 * What a webhook delivery says, as far as this API cares. Four kinds change something — a
 * payment that succeeded, a refund, a dispute opened and a dispute closed — a fifth, a
 * refund the bank sent back, is reported for a person to act on, and every other event is
 * recorded and acknowledged, because a provider that hears no `2xx` delivers again for days.
 * `account` is news about a host's connected account, from the payout webhook; it goes
 * through the same inbox (`PaymentEventDispatcher`) so both webhooks answer at once.
 */
export type PaymentEvent =
  | {
      kind: "succeeded";
      eventId: string;
      type: string;
      paymentId: string;
      /** The charge the payment produced, which the host's transfer is funded from. */
      chargeId: string | null;
      /** The booking the payment was opened for, read off the payment itself. */
      bookingId: string | null;
      /** What was actually taken, which is what a late payment has to give back. */
      amount: number;
    }
  | {
      /** A charge was refunded, by this API or from the provider's dashboard. */
      kind: "refunded";
      eventId: string;
      type: string;
      paymentId: string;
      chargeId: string;
      /** Everything refunded of the charge so far — a total, not this refund alone. */
      amountRefunded: number;
    }
  | {
      /**
       * A refund the guest's bank could not take: the money is back on the platform's
       * balance and still the guest's. Nothing is undone automatically — see
       * `BookingPaymentHandler` — so the event names what a person needs to issue it again.
       */
      kind: "refundFailed";
      eventId: string;
      type: string;
      paymentId: string;
      refundId: string;
      amount: number;
      /** The bank's reason, as the provider words it; `null` when it gives none. */
      reason: string | null;
    }
  | {
      kind: "disputed";
      eventId: string;
      type: string;
      paymentId: string;
    }
  | {
      kind: "disputeClosed";
      eventId: string;
      type: string;
      paymentId: string;
      /** Only the outcome matters: whether the money stayed with the platform. */
      won: boolean;
    }
  | {
      kind: "account";
      eventId: string;
      type: string;
      /** `null` for an event about something other than an account. */
      accountId: string | null;
    }
  | { kind: "other"; eventId: string; type: string };

export class InvalidPaymentEventError extends Error {
  constructor(reason: string) {
    super(`The payment event could not be verified: ${reason}`);
    this.name = "InvalidPaymentEventError";
  }
}
