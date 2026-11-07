import type { PublicOf } from "../../../common/testing/public-of.fakes";
import {
  PaymentGateway,
  PaymentOpeningInProgressError,
  type OpenedPayment,
  type PaymentEvent,
} from "../../../payment/application/ports/payment-gateway";
import { addCents, NO_CENTS, type Cents } from "../../../payment/domain/money";

/**
 * The provider, as far as the rules here care: which payments were opened, withdrawn and
 * refunded, under which keys. Refunds are recorded by key the way Stripe treats them — a
 * second call with a key already used is the same refund, not another one.
 */
export class FakePaymentGateway implements PublicOf<PaymentGateway> {
  readonly opened = new Map<string, OpenedPayment>();
  readonly withdrawn: string[] = [];
  readonly refunds = new Map<string, { paymentId: string; amount: Cents }>();

  /** Set to have every refund fail, as a provider that cannot be reached would. */
  refusing = false;

  /** Set to have a withdrawal fail, as it does for a payment that completed already. */
  refusingWithdrawal = false;

  /** Set to have `open` find another request opening the same payment under its key. */
  openingElsewhere = false;

  open(bookingId: string): Promise<OpenedPayment> {
    if (this.openingElsewhere) {
      return Promise.reject(new PaymentOpeningInProgressError(bookingId));
    }

    const opened = this.opened.get(bookingId) ?? {
      id: `pi_${String(this.opened.size + 1)}`,
      clientSecret: `pi_${String(this.opened.size + 1)}_secret`,
    };

    this.opened.set(bookingId, opened);

    return Promise.resolve(opened);
  }

  cancel(paymentId: string): Promise<void> {
    if (this.refusingWithdrawal) {
      return Promise.reject(new Error("payment_intent_unexpected_state"));
    }

    this.withdrawn.push(paymentId);

    return Promise.resolve();
  }

  refund(paymentId: string, amount: Cents, key: string): Promise<Cents> {
    if (this.refusing) return Promise.reject(new Error("api_connection_error"));

    const sent = this.refunds.get(key) ?? { paymentId, amount };

    this.refunds.set(key, sent);

    return Promise.resolve(sent.amount);
  }

  /** Refunds made from the dashboard whose webhook has not arrived yet, by payment. */
  readonly refundedUnreported = new Map<string, Cents>();

  refundedSoFar(paymentId: string): Promise<Cents> {
    const issued = [...this.refunds.values()]
      .filter((refund) => refund.paymentId === paymentId)
      .reduce((total, refund) => addCents(total, refund.amount), NO_CENTS);

    return Promise.resolve(
      addCents(issued, this.refundedUnreported.get(paymentId) ?? NO_CENTS),
    );
  }

  readEvent(): PaymentEvent {
    throw new Error("The webhook controller's to call, not the service's");
  }
}
