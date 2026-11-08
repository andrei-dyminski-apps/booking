import type { Cents, Currency } from "../../domain/money";

/**
 * The guest's payments. An abstract class, so the class itself is the DI token. Amounts are
 * whole cents, as the provider counts them too.
 */
export abstract class PaymentGateway {
  /**
   * Opens the payment of one hold, or answers the one already opened for it — in the
   * currency the stay was quoted in, which the row stores beside its amount.
   */
  abstract open(
    bookingId: string,
    amount: Cents,
    currency: Currency,
  ): Promise<OpenedPayment>;

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
    amount: Cents,
    key: string,
  ): Promise<Cents>;

  /**
   * Sends `amount` back while an admin waits on the answer, so in the request's time. `key`
   * names the refund — `findRefunds` finds it by it — and with the amount it is the request's
   * idempotency key: a retry of the same amount answers the refund it sent, and another
   * amount after the provider refused the first is a request of its own rather than the
   * refusal the provider keeps for the key. Unlike `refund` it looks nothing up — the caller
   * asked `findRefunds` just before. It throws `RefundExceedsPaymentError` for more than the
   * provider has left to give back and `RefundRefusedError` for any other refusal of the
   * request: either way the provider answered, and nothing went out under it.
   */
  abstract refundNow(
    paymentId: string,
    amount: Cents,
    key: string,
  ): Promise<SentRefund>;

  /**
   * One read of the payment's refunds, in the request's time like `refundNow`: what the
   * provider has given back so far — a refund whose webhook is late included — and the
   * refund sent under `key`, or `null`, so a press whose answer was lost is found rather
   * than sent again.
   */
  abstract findRefunds(paymentId: string, key: string): Promise<PaymentRefunds>;

  /** Refunded so far as the provider knows it, a dashboard refund whose webhook is late included. */
  abstract refundedSoFar(paymentId: string): Promise<Cents>;

  /** Throws `InvalidPaymentEventError` for anything the provider did not sign. */
  abstract readEvent(payload: Buffer, signature: string): PaymentEvent;
}

/** A refund the provider holds: its id, and what it gave back. */
export type SentRefund = { id: string; amount: Cents };

/** A payment's refunds as `findRefunds` reads them. */
export type PaymentRefunds = {
  /** Given back so far: every refund not cancelled and not failed. */
  refunded: Cents;
  /** The refund the key names. */
  sent: SentRefund | null;
};

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
      amount: Cents;
    }
  | {
      kind: "refunded";
      eventId: string;
      type: string;
      paymentId: string;
      chargeId: string;
      /** The charge's refund total so far, not this refund alone. */
      amountRefunded: Cents;
    }
  | {
      /** The guest's bank sent a refund back; the money is the guest's and a person sends it back. */
      kind: "refundFailed";
      eventId: string;
      type: string;
      paymentId: string;
      refundId: string;
      amount: Cents;
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

/**
 * `refundNow` of more than the payment has left: a refund went out between the caller's
 * `findRefunds` and its `refundNow` — the dashboard's, since every refund this API sends
 * waits on the stay's lease.
 */
export class RefundExceedsPaymentError extends Error {
  constructor(paymentId: string) {
    super(`The refund is more than payment ${paymentId} has left to give back`);
    this.name = "RefundExceedsPaymentError";
  }
}

/**
 * `refundNow` refused by the provider for a reason of its own — a payment disputed before its
 * webhook arrived, a charge past the provider's window for refunds. An answer rather than a
 * silence: nothing went out under the request, so the caller may let its claim go.
 */
export class RefundRefusedError extends Error {
  constructor(
    paymentId: string,
    readonly reason: string,
  ) {
    super(`The refund of payment ${paymentId} was refused: ${reason}`);
    this.name = "RefundRefusedError";
  }
}

export class InvalidPaymentEventError extends Error {
  constructor(reason: string) {
    super(`The payment event could not be verified: ${reason}`);
    this.name = "InvalidPaymentEventError";
  }
}
