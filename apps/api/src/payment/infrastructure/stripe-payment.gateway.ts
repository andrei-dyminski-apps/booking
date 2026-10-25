import { Inject, Injectable, Logger } from "@nestjs/common";
import Stripe from "stripe";
import { z } from "zod";
import {
  InvalidPaymentEventError,
  PaymentGateway,
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
 * The port over Stripe, through PaymentIntents — the guest's half of the money. The host's
 * half is `StripePayoutGateway`; the two share a client factory and the conversion into
 * cents (`stripe-client.ts`), which happens at this edge alone.
 */
@Injectable()
export class StripePaymentGateway extends PaymentGateway {
  private readonly logger = new Logger(StripePaymentGateway.name);
  private readonly stripe: Stripe;

  /** Whether an event in another API version was reported already — once per process. */
  private versionMismatchReported = false;

  constructor(
    @Inject(PAYMENT_CONFIG) private readonly paymentConfig: PaymentConfig,
  ) {
    super();
    this.stripe = createStripeClient(paymentConfig.secretKey);
  }

  /**
   * Keyed by the booking, so a second call replays the same intent (Stripe keeps a key 24
   * hours, a hold lives 15 minutes). No list of payment methods: the dashboard decides, and
   * must enable only methods that confirm at once — one `processing` for days outlives its
   * hold and is refunded in full on arrival.
   */
  async open(bookingId: string, amount: number): Promise<OpenedPayment> {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: toCents(amount),
        currency: CURRENCY,
        // What the webhook finds the booking by, and whose database holds it.
        metadata: { bookingId, site: this.paymentConfig.site },
        // The charge and the host's transfer it funds, grouped in the dashboard.
        transfer_group: transferGroupOf(bookingId),
      },
      { idempotencyKey: `booking-${bookingId}-payment` },
    );

    if (intent.client_secret === null) {
      throw new Error(`PaymentIntent ${intent.id} came back without a secret`);
    }

    return { id: intent.id, clientSecret: intent.client_secret };
  }

  async cancel(paymentId: string): Promise<void> {
    try {
      await this.stripe.paymentIntents.cancel(paymentId);
    } catch (error) {
      // Cancelled already — a retried job — or completed in the meantime, which the webhook
      // refunds. Either way there is nothing left to withdraw, and a retry would change
      // nothing but the log.
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

  /** What the refund named by `key` gave back, or `null` when none was sent. */
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
   * An event is shaped by the API version of the endpoint that sent it, not by the one the
   * SDK pins, and the fields read above are typed against the latter. A mismatch is not
   * refused — most fields read the same across versions — but said once, loudly enough to
   * set the endpoint right.
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
   * The booking a payment was opened for, if this deployment opened it. Another site's
   * payment names a booking of another database, and anything that is not a uuid — a
   * payment made by hand, `stripe trigger` — would fail the `uuid` column's query and have
   * the delivery come again for days.
   */
  private bookingIdOf(metadata: Stripe.Metadata): string | null {
    const { bookingId, site } = metadata;

    return site === this.paymentConfig.site &&
      z.uuid().safeParse(bookingId).success
      ? (bookingId ?? null)
      : null;
  }
}
