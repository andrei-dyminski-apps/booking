import type { PaymentEvent } from "../../../payment/application/ports/payment-gateway";

/**
 * The port hosts are paid through, beside `PaymentGateway`: the guest's payment is a charge
 * on the platform, the host's payout a connected account and a transfer into it. Euros to
 * the cent here too.
 */
export abstract class PayoutGateway {
  /** Opens the account a host is paid to; named after the user, so a repeat gets the same one. */
  abstract createRecipientAccount(host: PayoutHost): Promise<string>;

  /** A short-lived secret for the provider's embedded components, for this one account. */
  abstract createAccountSession(accountId: string): Promise<string>;

  /** Whether the account can receive transfers right now, asked of the provider. */
  abstract transfersEnabled(accountId: string): Promise<boolean>;

  /**
   * Sends the host their share of one stay, funded by the guest's charge, once per booking.
   * The answer is the transfer that exists for the stay — possibly one an earlier run sent
   * with another amount — and what the host holds of it.
   */
  abstract transfer(payout: Payout): Promise<SentTransfer>;

  /** Takes `amount` of a transfer back; a second call with the same `key` is the same reversal. */
  abstract reverseTransfer(
    transferId: string,
    amount: number,
    key: string,
  ): Promise<void>;

  /** Reads one delivery of the account events; throws `InvalidPaymentEventError` if unsigned. */
  abstract readAccountEvent(payload: Buffer, signature: string): AccountEvent;
}

/** What the provider is told about the person an account is opened for. */
export type PayoutHost = {
  userId: string;
  email: string;
  name: string;
};

export type Payout = {
  bookingId: string;
  accountId: string;
  /** The guest's charge: the transfer waits for its funds rather than the platform's. */
  chargeId: string;
  amount: number;
  /** What the host reads beside the transfer in their payouts list. */
  description: string;
};

/** A transfer as the provider holds it: its id, and what the host holds of it now. */
export type SentTransfer = {
  id: string;
  amount: number;
};

/**
 * One delivery about a connected account. Only the account matters — what changed is read
 * from the provider afresh, because the delivery itself carries nothing but the news that
 * something did. A kind of `PaymentEvent`, so it goes through the same inbox.
 */
export type AccountEvent = Extract<PaymentEvent, { kind: "account" }>;
