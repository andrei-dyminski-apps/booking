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
 * Hosts are Accounts v2 recipients: the platform charges the guest itself, so an account
 * only receives transfers. The platform carries fees and losses (`application`), which is
 * why a refund or lost dispute after a payout is taken back from the host by a reversal.
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

  /** The Express dashboard, so a host gets Stripe's own support and emails about the account. */
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
    // Stripe forgets a key after 24 hours; a transfer sent and never recorded would go twice.
    const sent = await this.findTransfer(payout.bookingId);

    if (sent !== null) return sent;

    try {
      const transfer = await this.stripe.transfers.create(
        {
          amount: toCents(payout.amount),
          currency: CURRENCY,
          destination: payout.accountId,
          source_transaction: payout.chargeId,
          transfer_group: transferGroupOf(payout.bookingId),
          description: payout.description,
          metadata: { bookingId: payout.bookingId },
        },
        { idempotencyKey: `booking-${payout.bookingId}-payout` },
      );

      return { id: transfer.id, amount: heldOf(transfer) };
    } catch (error) {
      // A run racing this one with another amount is refused by the key; the transfer the
      // other run sent is the answer. A key that named the amount would have sent two.
      if (!(error instanceof Stripe.errors.StripeIdempotencyError)) throw error;

      const existing = await this.findTransfer(payout.bookingId);

      if (existing === null) throw error;

      return existing;
    }
  }

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

function heldOf(transfer: Stripe.Transfer): number {
  return fromMinorUnits(transfer.amount - transfer.amount_reversed);
}
