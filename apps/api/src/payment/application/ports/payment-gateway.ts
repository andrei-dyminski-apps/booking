/**
 * The guest's payments. An abstract class, so the class itself is the DI token. Amounts are
 * the contract's euros; only the adapter counts cents.
 */
export abstract class PaymentGateway {
  /** Opens the payment of one hold, or answers the one already opened for it. */
  abstract open(bookingId: string, amount: number): Promise<OpenedPayment>;

  /**
   * Withdraws a payment whose hold lapsed or was cancelled. One already withdrawn or
   * completed is no failure: a completed one reaches the webhook, which refunds it.
   */
  abstract cancel(paymentId: string): Promise<void>;

  /**
   * Gives `amount` back once per `key` — for good, not only for the provider's 24 hours of
   * idempotency. Answers what the refund named by `key` gave back (an earlier attempt may
   * have sent another amount), and 0 for a payment already refunded in full.
   */
  abstract refund(
    paymentId: string,
    amount: number,
    key: string,
  ): Promise<number>;

  /** Refunded so far as the provider knows it, a dashboard refund whose webhook is late included. */
  abstract refundedSoFar(paymentId: string): Promise<number>;

  /** Throws `InvalidPaymentEventError` for anything the provider did not sign. */
  abstract readEvent(payload: Buffer, signature: string): PaymentEvent;
}

export type OpenedPayment = {
  id: string;
  /** What the browser confirms the payment with; see `bookingPaymentSchema`. */
  clientSecret: string;
};

/**
 * A webhook delivery, as far as this API cares. Every other event is `other`: recorded and
 * acknowledged, because a provider that hears no `2xx` delivers again for days. `account`
 * comes from the payout webhook and shares the inbox, so both webhooks answer at once.
 */
export type PaymentEvent =
  | {
      kind: "succeeded";
      eventId: string;
      type: string;
      paymentId: string;
      /** What the host's transfer is funded from. */
      chargeId: string | null;
      /** Read off the payment's metadata; `null` for a payment this site did not open. */
      bookingId: string | null;
      /** What was actually taken — what a late payment gives back. */
      amount: number;
    }
  | {
      kind: "refunded";
      eventId: string;
      type: string;
      paymentId: string;
      chargeId: string;
      /** The charge's refund total so far, not this refund alone. */
      amountRefunded: number;
    }
  | {
      /** The guest's bank sent a refund back; the money is the guest's and a person re-sends it. */
      kind: "refundFailed";
      eventId: string;
      type: string;
      paymentId: string;
      refundId: string;
      amount: number;
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
      won: boolean;
    }
  | {
      kind: "account";
      eventId: string;
      type: string;
      accountId: string | null;
    }
  | { kind: "other"; eventId: string; type: string };

/**
 * `open` while another request is opening the same payment under the same key — two clicks,
 * or a form mounted twice. The provider refuses the second until the first is answered, and
 * a retry then gets that same payment.
 */
export class PaymentOpeningInProgressError extends Error {
  constructor(bookingId: string) {
    super(
      `The payment of booking ${bookingId} is being opened by another request`,
    );
    this.name = "PaymentOpeningInProgressError";
  }
}

export class InvalidPaymentEventError extends Error {
  constructor(reason: string) {
    super(`The payment event could not be verified: ${reason}`);
    this.name = "InvalidPaymentEventError";
  }
}
