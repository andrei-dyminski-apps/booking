import type { PayoutCountry } from "@repo/contracts";
import type { PaymentEvent } from "../../../payment/application/ports/payment-gateway";
import type { Cents, Currency } from "../../../payment/domain/money";

/** Hosts are paid through a connected account and a transfer into it. Whole cents, like `PaymentGateway`. */
export abstract class PayoutGateway {
  /**
   * Keyed by everything it sends, so the same request repeated within thirty days (a v2
   * key's life) gets the same account, and a different one — another country, a new name —
   * opens another. Throws `PayoutAccountOpeningInProgressError` while another request
   * opens it.
   */
  abstract createRecipientAccount(host: PayoutHost): Promise<string>;

  /** An account opened for nobody: a racing request wrote another into the column first. */
  abstract closeAccount(accountId: string): Promise<void>;

  /**
   * The countries a host's account can be opened in: those the platform's own country
   * transfers to, each account in its own country's currency. The Stripe adapter answers
   * from a snapshot in the repository, without asking Stripe.
   */
  abstract transferCountries(): Promise<PayoutCountry[]>;

  abstract createAccountSession(accountId: string): Promise<string>;

  /** Asked by a request and by the background alike, so the caller says which it is. */
  abstract transfersEnabled(
    accountId: string,
    caller: Caller,
  ): Promise<boolean>;

  /**
   * Once per booking: answers the transfer that exists, possibly an earlier run's with another
   * amount. The idempotency key names the reservation, so a retry of it is the same request.
   */
  abstract transfer(payout: Payout): Promise<SentTransfer>;

  /** The booking's transfer if one went out, without sending one — a lost write's answer. */
  abstract findTransfer(bookingId: string): Promise<SentTransfer | null>;

  /** What was sent less every reversal, one whose write was lost included. */
  abstract heldOnTransfer(transferId: string): Promise<Cents>;

  /** A second call with the same `key` is the same reversal. */
  abstract reverseTransfer(
    transferId: string,
    amount: Cents,
    key: string,
  ): Promise<void>;

  /** Throws `InvalidPaymentEventError` for anything the provider did not sign. */
  abstract readAccountEvent(payload: Buffer, signature: string): AccountEvent;
}

/**
 * Who waits on the answer: a request, inside the frontend's ten seconds, or nobody — a job
 * or the inbox's worker, which the adapter gives a longer wait and retries of its own.
 */
export type Caller = "request" | "background";

export type PayoutHost = {
  userId: string;
  email: string;
  name: string;
  /** Fixed by Stripe once the account is opened; onboarding asks for this country's details. */
  country: PayoutCountry;
};

export type Payout = {
  bookingId: string;
  accountId: string;
  /** The transfer waits for this charge's funds rather than drawing on the platform's. */
  chargeId: string;
  amount: Cents;
  /**
   * Which reservation of the stay's payout this sends (`payout_reservations`): part of the
   * idempotency key, because a reservation made afresh may send another amount, and Stripe
   * refuses a key it has seen with other parameters — or replays its saved failure — for 24 hours.
   */
  reservation: number;
  /** The stay's, so the host is paid in what the guest was charged in. */
  currency: Currency;
  description: string;
};

export type SentTransfer = {
  id: string;
  amount: Cents;
};

/**
 * `createRecipientAccount` while another request opens the same account under the same key —
 * two tabs, or a press repeated after a lost answer. The provider refuses the second until
 * the first is answered, and a retry then gets that same account.
 */
export class PayoutAccountOpeningInProgressError extends Error {
  constructor(userId: string) {
    super(
      `The payout account of user ${userId} is being opened by another request`,
    );
    this.name = "PayoutAccountOpeningInProgressError";
  }
}

/**
 * `createRecipientAccount` refused for the country itself — Stripe will not open an account
 * there as this platform asks for one (a configuration it needs beside the transfers, a
 * currency its spec names and Stripe does not take). The list the host picked from said
 * otherwise, so the adapter drops the country from it as well.
 */
export class PayoutCountryRefusedError extends Error {
  constructor(
    readonly country: string,
    readonly reason: string,
  ) {
    super(`Stripe will not open a payout account in ${country}: ${reason}`);
    this.name = "PayoutCountryRefusedError";
  }
}

/** A thin event carries only the account; what changed is asked of the provider afresh. */
export type AccountEvent = Extract<PaymentEvent, { kind: "account" }>;
