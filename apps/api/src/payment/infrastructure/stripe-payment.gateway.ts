import { Inject, Injectable, Logger } from "@nestjs/common";
import Stripe from "stripe";
import { z } from "zod";
import {
  InvalidPaymentEventError,
  PaymentGateway,
  PaymentOpeningInProgressError,
  RefundExceedsPaymentError,
  RefundRefusedError,
  type OpenedPayment,
  type PaymentEvent,
  type PaymentRefunds,
  type SentRefund,
} from "../application/ports/payment-gateway";
import {
  addCents,
  cents,
  NO_CENTS,
  type Cents,
  type Currency,
} from "../domain/money";
import { PAYMENT_CONFIG, type PaymentConfig } from "./payment.config";
import {
  BACKGROUND_REQUEST,
  idOf,
  STRIPE_API_VERSION,
  STRIPE_CLIENT,
  transferGroupOf,
} from "./stripe";

/**
 * The payment methods a hold may be paid with: those Stripe confirms at once, in Europe and
 * in the Americas. A method that stays `processing` — SEPA and ACH Direct Debit, Canadian
 * pre-authorized debits, bank transfers, Multibanco — would outlive the fifteen-minute hold
 * and be refunded in full on arrival. Wallets on top of cards (Apple Pay, Google Pay) come
 * with `card`.
 *
 * An allow-list rather than `payment_method_types`, which `STRIPE_API_VERSION` no longer
 * accepts: Stripe leaves out a listed method the dashboard has not enabled, or that the
 * currency, the amount or the platform account's country rules out, instead of refusing
 * the payment. So the list is wider than what a guest is offered — a platform account in
 * Poland charging dollars offers `card`, `link` and `paypal`. The European ones (Revolut
 * Pay, iDEAL, Wero, Bancontact, EPS, MobilePay, MB WAY) take no dollars and wait for a
 * `CURRENCY` they take; Klarna presents a European business only in the customer's own
 * currency; Amazon Pay leaves Poland out of the countries it serves, and Cash App Pay,
 * Afterpay and Zip take dollars only from a business in the US (Afterpay also in Canada,
 * the UK, Australia and New Zealand) — those wait for the account's country instead.
 * Alipay and WeChat Pay confirm at once and take dollars too, but not from Poland, so they
 * are not listed. Przelewy24, Satispay and Affirm are left out because they prohibit
 * lodging merchants.
 *
 * The stay's page relies on the list as well: it reads `processing` as paid and takes the
 * form away until the webhook (`bankAnswerOf` and `PAID` in `apps/web`), which is safe only
 * while `processing` is a moment before `succeeded`. A method that settles later is a change
 * there before it is a line here.
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
  private versionMismatchReported = false;

  constructor(
    @Inject(PAYMENT_CONFIG) private readonly paymentConfig: PaymentConfig,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {
    super();
  }

  /** Keyed by the booking: Stripe keeps a key 24 hours, a hold lives 15 minutes. */
  async open(
    bookingId: string,
    amount: Cents,
    currency: Currency,
  ): Promise<OpenedPayment> {
    let intent: Stripe.PaymentIntent;

    try {
      intent = await this.stripe.paymentIntents.create(
        {
          amount,
          currency,
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
      await this.stripe.paymentIntents.cancel(
        paymentId,
        {},
        BACKGROUND_REQUEST,
      );
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

  async refund(paymentId: string, amount: Cents, key: string): Promise<Cents> {
    // Looked up first rather than trusted to the idempotency key alone: Stripe forgets a key
    // after 24 hours, and a refund whose answer was lost would be sent again after that.
    const sent = await this.findSent(paymentId, key, BACKGROUND_REQUEST);

    if (sent !== null) return sent.amount;

    try {
      return (
        await this.sendRefund(paymentId, amount, key, key, BACKGROUND_REQUEST)
      ).amount;
    } catch (error) {
      // Everything went back already — a refund from the dashboard in between.
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.code === "charge_already_refunded"
      ) {
        return NO_CENTS;
      }

      // The key used with another amount by a run racing this one: that refund stands.
      if (error instanceof Stripe.errors.StripeIdempotencyError) {
        const existing = await this.findSent(
          paymentId,
          key,
          BACKGROUND_REQUEST,
        );

        if (existing !== null) return existing.amount;
      }

      throw error;
    }
  }

  /**
   * The amount is in the idempotency key and not in `metadata.key`: Stripe keeps a refusal
   * for its key for 24 hours, so an admin who lowers an amount Stripe refused would otherwise
   * be answered the same refusal — and a lower amount, `StripeIdempotencyError` — until the
   * dialog mints another request. A retry of the same amount is still the same request.
   *
   * Neither idempotency refusal is looked behind, unlike in `refund`, and neither releases
   * the claim. A key in use (`idempotency_key_in_use`) is a `409`, which the SDK makes a
   * `StripeAPIError` by its status whatever the body's type: the press's own earlier request
   * is still in flight under it and may yet refund, so it goes up as an unknown outcome and
   * the next press reads `findRefunds` first. A key reused with other parameters
   * (`StripeIdempotencyError`) cannot happen here — the key carries every parameter — and
   * goes up as it is.
   *
   * Every other `invalid_request_error` is Stripe's answer about the request — the charge is
   * disputed, too old, already refunded — not a silence, so it is `RefundRefusedError`: the
   * request was not carried out, and a refusal saved under the key is the same refusal
   * again. What stays as it is — a timeout, a `5xx`, a key in use — leaves the outcome
   * unknown.
   */
  async refundNow(
    paymentId: string,
    amount: Cents,
    key: string,
  ): Promise<SentRefund> {
    try {
      return await this.sendRefund(
        paymentId,
        amount,
        key,
        `${key}-${String(amount)}`,
      );
    } catch (error) {
      if (exceedsPayment(error)) throw new RefundExceedsPaymentError(paymentId);

      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        throw new RefundRefusedError(paymentId, error.message);
      }

      throw error;
    }
  }

  findRefunds(paymentId: string, key: string): Promise<PaymentRefunds> {
    return this.readRefunds(paymentId, key);
  }

  /** `key` names the refund (`metadata.key`, what `readRefunds` reads); `idempotencyKey` is the request's. */
  private async sendRefund(
    paymentId: string,
    amount: Cents,
    key: string,
    idempotencyKey: string,
    options?: Stripe.RequestOptions,
  ): Promise<SentRefund> {
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: paymentId,
        amount,
        metadata: { key },
      },
      { idempotencyKey, ...options },
    );

    return { id: refund.id, amount: cents(refund.amount) };
  }

  private async findSent(
    paymentId: string,
    key: string,
    options?: Stripe.RequestOptions,
  ): Promise<SentRefund | null> {
    return (await this.readRefunds(paymentId, key, options)).sent;
  }

  /**
   * Every refund of the payment, read once. A refund the bank sent back (`failed`) or one
   * cancelled before it went gives nothing back, as `charge.amount_refunded` counts; the one
   * the key names is any but a cancelled one — a failed refund was still sent.
   */
  private async readRefunds(
    paymentId: string,
    key: string,
    options?: Stripe.RequestOptions,
  ): Promise<PaymentRefunds> {
    let refunded = NO_CENTS;
    let sent: SentRefund | null = null;

    for await (const refund of this.stripe.refunds.list(
      { payment_intent: paymentId, limit: 100 },
      options,
    )) {
      if (refund.status === "canceled") continue;

      if (refund.status !== "failed") {
        refunded = addCents(refunded, cents(refund.amount));
      }

      if (sent === null && refund.metadata?.key === key) {
        sent = { id: refund.id, amount: cents(refund.amount) };
      }
    }

    return { refunded, sent };
  }

  async refundedSoFar(paymentId: string): Promise<Cents> {
    const intent = await this.stripe.paymentIntents.retrieve(
      paymentId,
      { expand: ["latest_charge"] },
      BACKGROUND_REQUEST,
    );
    const charge = intent.latest_charge;

    return charge === null || typeof charge === "string"
      ? NO_CENTS
      : cents(charge.amount_refunded);
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
          amount: cents(intent.amount_received),
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
          amountRefunded: cents(charge.amount_refunded),
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
              amount: cents(refund.amount),
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

/**
 * Stripe's refusal of a refund past what the charge has left: fully refunded already
 * (`charge_already_refunded`), or less left than asked for — an `amount` refusal with no code
 * of its own, or `amount_too_large`. Any other refusal of the amount (`parameter_invalid_*`)
 * is not that, and is `RefundRefusedError` like every other refusal.
 */
function exceedsPayment(error: unknown): boolean {
  if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) return false;

  return (
    error.code === "charge_already_refunded" ||
    (error.param === "amount" &&
      (error.code === undefined || error.code === "amount_too_large"))
  );
}
