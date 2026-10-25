import { Inject, Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { InvalidPaymentEventError } from "../../payment/application/ports/payment-gateway";
import { CURRENCY } from "../../payment/domain/currency";
import { toCents } from "../../payment/domain/money";
import {
  PAYMENT_CONFIG,
  type PaymentConfig,
} from "../../payment/infrastructure/payment.config";
import {
  createStripeClient,
  fromMinorUnits,
  transferGroupOf,
} from "../../payment/infrastructure/stripe-client";
import {
  PayoutGateway,
  type AccountEvent,
  type Payout,
  type PayoutHost,
  type SentTransfer,
} from "../application/ports/payout-gateway";

/**
 * The port over Stripe Connect — the host's half of the money. Hosts are Accounts v2
 * recipients: the platform is the merchant of record and charges the guest itself, so an
 * account here only ever receives transfers, and onboarding asks a host for no more than
 * that takes.
 *
 * The platform carries the fees and the losses (`application` for both — the only pair a
 * recipient without a full dashboard may have), which is also why a refund or a lost
 * dispute after a payout is the platform's to take back from the host, by a reversal.
 */
@Injectable()
export class StripePayoutGateway extends PayoutGateway {
  private readonly stripe: Stripe;

  constructor(
    @Inject(PAYMENT_CONFIG) private readonly paymentConfig: PaymentConfig,
  ) {
    super();
    this.stripe = createStripeClient(paymentConfig.secretKey);
  }

  /**
   * The Express dashboard rather than none: a host gets Stripe's own support and emails
   * about their account, while the payouts screen of this site embeds the parts they use.
   */
  async createRecipientAccount(host: PayoutHost): Promise<string> {
    const account = await this.stripe.v2.core.accounts.create(
      {
        contact_email: host.email,
        display_name: host.name,
        dashboard: "express",
        defaults: {
          currency: CURRENCY,
          responsibilities: {
            fees_collector: "application",
            losses_collector: "application",
          },
        },
        configuration: {
          recipient: {
            capabilities: {
              stripe_balance: { stripe_transfers: { requested: true } },
            },
          },
        },
        metadata: { userId: host.userId },
      },
      { idempotencyKey: `user-${host.userId}-account` },
    );

    return account.id;
  }

  async createAccountSession(accountId: string): Promise<string> {
    const session = await this.stripe.accountSessions.create({
      account: accountId,
      components: {
        account_onboarding: { enabled: true },
        payouts: { enabled: true },
        notification_banner: { enabled: true },
      },
    });

    return session.client_secret;
  }

  async transfersEnabled(accountId: string): Promise<boolean> {
    const account = await this.stripe.v2.core.accounts.retrieve(accountId, {
      include: ["configuration.recipient"],
    });

    return (
      account.configuration?.recipient?.capabilities?.stripe_balance
        ?.stripe_transfers?.status === "active"
    );
  }

  async transfer(payout: Payout): Promise<SentTransfer> {
    // Looked up before sending, not only when the key refuses a retry: Stripe forgets a key
    // after 24 hours, and a transfer sent and never recorded — a database that failed the
    // write, a run that crashed — would be sent again by the first retry after that.
    const sent = await this.findTransfer(payout.bookingId);

    if (sent !== null) return sent;

    try {
      const transfer = await this.stripe.transfers.create(
        {
          amount: toCents(payout.amount),
          currency: CURRENCY,
          destination: payout.accountId,
          // Funded by the guest's own charge: the transfer is accepted at once and waits for
          // that money to settle instead of drawing on whatever the platform holds.
          source_transaction: payout.chargeId,
          transfer_group: transferGroupOf(payout.bookingId),
          description: payout.description,
          metadata: { bookingId: payout.bookingId },
        },
        { idempotencyKey: `booking-${payout.bookingId}-payout` },
      );

      return { id: transfer.id, amount: heldOf(transfer) };
    } catch (error) {
      // The key is the booking and remembers the first request's parameters for 24 hours. A
      // run racing this one with another amount — a refund landed between the two — is
      // refused for it, and the transfer the other run sent is handed back instead of
      // sending a second one, which a key that named the amount would have done.
      if (!(error instanceof Stripe.errors.StripeIdempotencyError)) throw error;

      const existing = await this.findTransfer(payout.bookingId);

      if (existing === null) throw error;

      return existing;
    }
  }

  /**
   * The transfer already sent for a stay, found by the group it shares with the charge and
   * the booking in its metadata. A stay has one: the key above and the empty `transfer_id`
   * it is recorded into both guarantee it.
   */
  private async findTransfer(bookingId: string): Promise<SentTransfer | null> {
    for await (const transfer of this.stripe.transfers.list({
      transfer_group: transferGroupOf(bookingId),
      limit: 100,
    })) {
      if (transfer.metadata?.bookingId === bookingId) {
        return { id: transfer.id, amount: heldOf(transfer) };
      }
    }

    return null;
  }

  async heldOnTransfer(transferId: string): Promise<number> {
    return heldOf(await this.stripe.transfers.retrieve(transferId));
  }

  async reverseTransfer(
    transferId: string,
    amount: number,
    key: string,
  ): Promise<void> {
    await this.stripe.transfers.createReversal(
      transferId,
      { amount: toCents(amount) },
      { idempotencyKey: key },
    );
  }

  readAccountEvent(payload: Buffer, signature: string): AccountEvent {
    let notification: Stripe.V2.Core.EventNotification;

    try {
      notification = this.stripe.parseEventNotification(
        payload,
        signature,
        this.paymentConfig.payoutWebhookSecret,
      );
    } catch (error) {
      throw new InvalidPaymentEventError(
        error instanceof Error ? error.message : String(error),
      );
    }

    const related =
      "related_object" in notification ? notification.related_object : null;

    return {
      kind: "account",
      eventId: notification.id,
      type: notification.type,
      accountId:
        related?.type === "v2.core.account" &&
        "id" in related &&
        typeof related.id === "string"
          ? related.id
          : null,
    };
  }
}

/** What the host holds of a transfer: what was sent, less whatever was taken back. */
function heldOf(transfer: Stripe.Transfer): number {
  return fromMinorUnits(transfer.amount - transfer.amount_reversed);
}
