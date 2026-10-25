import { Inject, Injectable, Logger } from "@nestjs/common";
import Stripe from "stripe";
import { z } from "zod";
import {
  InvalidPaymentEventError,
  PaymentGateway,
  PaymentOpeningInProgressError,
  type OpenedPayment,
  type PaymentEvent,
} from "../application/ports/payment-gateway";
import { CURRENCY } from "../domain/currency";
import { toCents } from "../domain/money";
import { PAYMENT_CONFIG, type PaymentConfig } from "./payment.config";
import {
  createStripeClient,
  fromMinorUnits,
  idOf,
  STRIPE_API_VERSION,
  transferGroupOf,
} from "./stripe-client";

/**
 * The payment methods a hold may be paid with: those Stripe confirms at once, in Europe and
 * in the Americas. A method that stays `processing` — SEPA and ACH Direct Debit, Canadian
 * pre-authorized debits, bank transfers, Multibanco — would outlive the fifteen-minute hold
 * and be refunded in full on arrival. Wallets on top of cards (Apple Pay, Google Pay) come
 * with `card`.
 *
 * An allow-list rather than `payment_method_types`, which `STRIPE_API_VERSION` no longer
 * accepts: Stripe leaves out a listed method the dashboard has not enabled, or that does
 * not take the currency or the amount, instead of refusing the payment — so the American
 * ones (Cash App Pay, Afterpay, Zip) wait for a `CURRENCY` they take. Przelewy24, Satispay
 * and Affirm confirm at once too, and are left out because they prohibit lodging merchants.
 */
const INSTANT_PAYMENT_METHODS = [
  "card",
  "link",
  "amazon_pay",
  "paypal",
  "klarna",
  // Europe
  "revolut_pay",
  "ideal",
  "wero",
  "bancontact",
  "eps",
  "mobilepay",
  "mb_way",
  // The Americas
  "cashapp",
  "afterpay_clearpay",
  "zip",
] as const;

/** The guest's half of the money, through PaymentIntents; the host's is `StripePayoutGateway`. */
@Injectable()
export class StripePaymentGateway extends PaymentGateway {
  private readonly logger = new Logger(StripePaymentGateway.name);
  private readonly stripe: Stripe;

  private versionMismatchReported = false;

  constructor(
    @Inject(PAYMENT_CONFIG) private readonly paymentConfig: PaymentConfig,
  ) {
    super();
    this.stripe = createStripeClient(paymentConfig.secretKey);
  }

  /** Keyed by the booking: Stripe keeps a key 24 hours, a hold lives 15 minutes. */
  async open(bookingId: string, amount: number): Promise<OpenedPayment> {
    let intent: Stripe.PaymentIntent;

    try {
      intent = await this.stripe.paymentIntents.create(
        {
          amount: toCents(amount),
          currency: CURRENCY,
          allowed_payment_method_types: [...INSTANT_PAYMENT_METHODS],
          // What the webhook finds the booking by, and whose database holds it.
          metadata: { bookingId, site: this.paymentConfig.site },
          transfer_group: transferGroupOf(bookingId),
        },
        { idempotencyKey: `booking-${bookingId}-payment` },
      );
    } catch (error) {
      // A `409` the SDK types as an API error rather than an idempotency one.
      if (
        error instanceof Stripe.errors.StripeError &&
        error.code === "idempotency_key_in_use"
      ) {
        throw new PaymentOpeningInProgressError(bookingId);
      }

      throw error;
    }

    if (intent.client_secret === null) {
      throw new Error(`PaymentIntent ${intent.id} came back without a secret`);
    }

    return { id: intent.id, clientSecret: intent.client_secret };
  }

  async cancel(paymentId: string): Promise<void> {
    try {
      await this.stripe.paymentIntents.cancel(paymentId);
    } catch (error) {
      // Cancelled already, or completed and refunded by the webhook: nothing to withdraw.
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.code === "payment_intent_unexpected_state"
      ) {
        return;
      }

      throw error;
    }
  }

  async refund(
    paymentId: string,
    amount: number,
    key: string,
  ): Promise<number> {
    // Looked up first rather than trusted to the idempotency key alone: Stripe forgets a key
    // after 24 hours, and a refund whose answer was lost would be sent again after that.
    const sent = await this.findRefund(paymentId, key);

    if (sent !== null) return sent;

    try {
      const refund = await this.stripe.refunds.create(
        {
          payment_intent: paymentId,
          amount: toCents(amount),
          metadata: { key },
        },
        { idempotencyKey: key },
      );

      return fromMinorUnits(refund.amount);
    } catch (error) {
      // Everything went back already — a refund from the dashboard in between.
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.code === "charge_already_refunded"
      ) {
        return 0;
      }

      // The key was used with another amount by a run racing this one: that refund stands.
      if (error instanceof Stripe.errors.StripeIdempotencyError) {
        const existing = await this.findRefund(paymentId, key);

        if (existing !== null) return existing;
      }

      throw error;
    }
  }

  private async findRefund(
    paymentId: string,
    key: string,
  ): Promise<number | null> {
    for await (const refund of this.stripe.refunds.list({
      payment_intent: paymentId,
      limit: 100,
    })) {
      if (refund.metadata?.key === key && refund.status !== "canceled") {
        return fromMinorUnits(refund.amount);
      }
    }

    return null;
  }

  async refundedSoFar(paymentId: string): Promise<number> {
    const intent = await this.stripe.paymentIntents.retrieve(paymentId, {
      expand: ["latest_charge"],
    });
    const charge = intent.latest_charge;

    return charge === null || typeof charge === "string"
      ? 0
      : fromMinorUnits(charge.amount_refunded);
  }

  readEvent(payload: Buffer, signature: string): PaymentEvent {
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.paymentConfig.paymentWebhookSecret,
      );
    } catch (error) {
      throw new InvalidPaymentEventError(
        error instanceof Error ? error.message : String(error),
      );
    }

    this.checkVersion(event);

    const { id: eventId, type } = event;

    switch (event.type) {
      case "payment_intent.succeeded": {
        const intent = event.data.object;

        return {
          kind: "succeeded",
          eventId,
          type,
          paymentId: intent.id,
          chargeId: idOf(intent.latest_charge),
          bookingId: this.bookingIdOf(intent.metadata),
          amount: fromMinorUnits(intent.amount_received),
        };
      }
      case "charge.refunded": {
        const charge = event.data.object;
        const paymentId = idOf(charge.payment_intent);

        // A charge with no PaymentIntent was not made by this API.
        if (paymentId === null) return { kind: "other", eventId, type };

        return {
          kind: "refunded",
          eventId,
          type,
          paymentId,
          chargeId: charge.id,
          amountRefunded: fromMinorUnits(charge.amount_refunded),
        };
      }
      case "refund.failed": {
        const refund = event.data.object;
        const paymentId = idOf(refund.payment_intent);

        return paymentId === null
          ? { kind: "other", eventId, type }
          : {
              kind: "refundFailed",
              eventId,
              type,
              paymentId,
              refundId: refund.id,
              amount: fromMinorUnits(refund.amount),
              reason: refund.failure_reason ?? null,
            };
      }
      case "charge.dispute.created": {
        const paymentId = idOf(event.data.object.payment_intent);

        return paymentId === null
          ? { kind: "other", eventId, type }
          : { kind: "disputed", eventId, type, paymentId };
      }
      case "charge.dispute.closed": {
        const dispute = event.data.object;
        const paymentId = idOf(dispute.payment_intent);

        // `warning_closed` is an inquiry that never became a dispute: no money moved.
        return paymentId === null
          ? { kind: "other", eventId, type }
          : {
              kind: "disputeClosed",
              eventId,
              type,
              paymentId,
              won: dispute.status !== "lost",
            };
      }
      default:
        return { kind: "other", eventId, type };
    }
  }

  /**
   * An event is shaped by its endpoint's API version, not the SDK's. Most fields read the
   * same across versions, so a mismatch is said once rather than refused.
   */
  private checkVersion(event: Stripe.Event): void {
    if (
      this.versionMismatchReported ||
      event.api_version === null ||
      event.api_version === STRIPE_API_VERSION
    ) {
      return;
    }

    this.versionMismatchReported = true;
    this.logger.warn(
      `Stripe delivered ${event.id} in API version ${event.api_version}, but this API reads ${STRIPE_API_VERSION} — set the webhook endpoint to that version`,
    );
  }

  /**
   * `null` for another site's payment, and for a booking id that is not a uuid (`stripe
   * trigger`), which would fail the column's query and be redelivered for days.
   */
  private bookingIdOf(metadata: Stripe.Metadata): string | null {
    const { bookingId, site } = metadata;

    return site === this.paymentConfig.site &&
      z.uuid().safeParse(bookingId).success
      ? (bookingId ?? null)
      : null;
  }
}
