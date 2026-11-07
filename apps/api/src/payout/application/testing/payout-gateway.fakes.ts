import type { PublicOf } from "../../../common/testing/public-of.fakes";
import {
  addCents,
  CURRENCY,
  NO_CENTS,
  subtractCents,
  type Cents,
} from "../../../payment/domain/money";
import type {
  AccountEvent,
  Caller,
  Payout,
  PayoutGateway,
  PayoutHost,
  SentTransfer,
} from "../ports/payout-gateway";
import { ACCOUNT_ID, BOOKING_ID, CHARGE_ID } from "./payout-fixtures.fakes";

/**
 * The provider's Connect half: transfers and reversals recorded by key, the way Stripe
 * treats them — a second call under a key already used is the same transfer, not another.
 */
export class FakePayoutGateway implements PublicOf<PayoutGateway> {
  readonly accounts: PayoutHost[] = [];
  readonly transfers = new Map<string, Payout & { id: string }>();
  readonly reversals = new Map<string, { transferId: string; amount: Cents }>();

  /**
   * What `transfersEnabled` answers for any account. On by default: a spec about a host
   * Stripe says cannot be paid turns it off, the way a lapsed capability would.
   */
  enabled = true;

  /** Each time Stripe was asked about an account, by who waits on the answer. */
  readonly askedBy: Caller[] = [];

  /** How many reversals fail before Stripe takes one, as a network that drops them would. */
  failingReversals = 0;

  /** Set to have Stripe refuse every transfer, as a restricted account's would be. */
  refusingTransfers = false;

  createRecipientAccount(host: PayoutHost): Promise<string> {
    this.accounts.push(host);

    return Promise.resolve(ACCOUNT_ID);
  }

  /** Set to have Stripe refuse the onboarding session, as an outage would. */
  refusingSessions = false;

  createAccountSession(accountId: string): Promise<string> {
    if (this.refusingSessions) {
      return Promise.reject(new Error("api_connection_error"));
    }

    return Promise.resolve(`${accountId}_session`);
  }

  transfersEnabled(_accountId: string, caller: Caller): Promise<boolean> {
    this.askedBy.push(caller);

    return Promise.resolve(this.enabled);
  }

  transfer(payout: Payout): Promise<SentTransfer> {
    if (this.refusingTransfers) {
      return Promise.reject(new Error("The transfer was refused"));
    }

    const key = `booking-${payout.bookingId}-payout`;
    const sent = this.transfers.get(key) ?? {
      ...payout,
      id: `tr_${String(this.transfers.size + 1)}`,
    };

    this.transfers.set(key, sent);

    // The adapter answers a retry with the transfer already sent, whatever the retry asked.
    return Promise.resolve({ id: sent.id, amount: sent.amount });
  }

  /** How many times Stripe was asked for a transfer by its group. */
  lookups = 0;

  findTransfer(bookingId: string): Promise<SentTransfer | null> {
    this.lookups += 1;

    const sent = this.transfers.get(`booking-${bookingId}-payout`);

    return Promise.resolve(
      sent === undefined ? null : { id: sent.id, amount: sent.amount },
    );
  }

  /** A transfer an earlier run sent, as Stripe would hold it. */
  sent(id: string, amount: Cents): void {
    this.transfers.set(`booking-${BOOKING_ID}-payout`, {
      bookingId: BOOKING_ID,
      accountId: ACCOUNT_ID,
      chargeId: CHARGE_ID,
      amount,
      reservation: 1,
      currency: CURRENCY,
      description: "sent earlier",
      id,
    });
  }

  /** What was sent less every reversal of it, the way Stripe reads `amount_reversed`. */
  heldOnTransfer(transferId: string): Promise<Cents> {
    const transfer = [...this.transfers.values()].find(
      ({ id }) => id === transferId,
    );

    if (transfer === undefined) {
      return Promise.reject(new Error(`No such transfer: ${transferId}`));
    }

    const reversed = [...this.reversals.values()]
      .filter((reversal) => reversal.transferId === transferId)
      .reduce((sum, { amount }) => addCents(sum, amount), NO_CENTS);

    return Promise.resolve(subtractCents(transfer.amount, reversed));
  }

  reverseTransfer(
    transferId: string,
    amount: Cents,
    key: string,
  ): Promise<void> {
    if (this.failingReversals > 0) {
      this.failingReversals -= 1;

      return Promise.reject(new Error("Stripe could not be reached"));
    }

    if (!this.reversals.has(key))
      this.reversals.set(key, { transferId, amount });

    // A real call takes a network round trip, which is when a second settlement arrives.
    return new Promise((resolve) => {
      setImmediate(resolve);
    });
  }

  readAccountEvent(): AccountEvent {
    throw new Error("The webhook controller's to call, not the service's");
  }
}
