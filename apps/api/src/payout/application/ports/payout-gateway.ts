import type { PaymentEvent } from "../../../payment/application/ports/payment-gateway";

/** Hosts are paid through a connected account and a transfer into it. Euros, like `PaymentGateway`. */
export abstract class PayoutGateway {
  /** Named after the user, so a repeat within 24 hours gets the same account. */
  abstract createRecipientAccount(host: PayoutHost): Promise<string>;

  abstract createAccountSession(accountId: string): Promise<string>;

  abstract transfersEnabled(accountId: string): Promise<boolean>;

  /** Once per booking: answers the transfer that exists, possibly an earlier run's with another amount. */
  abstract transfer(payout: Payout): Promise<SentTransfer>;

  /** What was sent less every reversal, one whose write was lost included. */
  abstract heldOnTransfer(transferId: string): Promise<number>;

  /** A second call with the same `key` is the same reversal. */
  abstract reverseTransfer(
    transferId: string,
    amount: number,
    key: string,
  ): Promise<void>;

  /** Throws `InvalidPaymentEventError` for anything the provider did not sign. */
  abstract readAccountEvent(payload: Buffer, signature: string): AccountEvent;
}

export type PayoutHost = {
  userId: string;
  email: string;
  name: string;
};

export type Payout = {
  bookingId: string;
  accountId: string;
  /** The transfer waits for this charge's funds rather than drawing on the platform's. */
  chargeId: string;
  amount: number;
  description: string;
};

export type SentTransfer = {
  id: string;
  amount: number;
};

/** A thin event carries only the account; what changed is asked of the provider afresh. */
export type AccountEvent = Extract<PaymentEvent, { kind: "account" }>;
