import { createHash } from "node:crypto";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { PayoutCountry } from "@repo/contracts";
import Stripe from "stripe";
import { InvalidPaymentEventError } from "../../payment/application/ports/payment-gateway";
import { cents, type Cents } from "../../payment/domain/money";
import {
  PAYMENT_CONFIG,
  type PaymentConfig,
} from "../../payment/infrastructure/payment.config";
import {
  BACKGROUND_REQUEST,
  STRIPE_CLIENT,
  transferGroupOf,
} from "../../payment/infrastructure/stripe";
import {
  PayoutAccountOpeningInProgressError,
  PayoutCountryRefusedError,
  PayoutGateway,
  type AccountEvent,
  type Caller,
  type Payout,
  type PayoutHost,
  type SentTransfer,
} from "../application/ports/payout-gateway";
import { PAYOUT_COUNTRY_CURRENCIES } from "./payout-countries.snapshot";

/** What v2 answers a recipient account that needs `merchant` `card_payments` beside it. */
const NEEDS_MERCHANT = "capability_not_available_without_other_capability";

/**
 * What v2 answers an account it will not open in the country asked for, as the platform
 * asks for it. `defaults.currency` is the country's own (`PAYOUT_COUNTRY_CURRENCIES`), so its
 * refusal is a fallback for a spec Stripe's check disagrees with; `NEEDS_MERCHANT` counts
 * only once the account was asked for with `merchant` as well and still refused.
 */
const COUNTRY_REFUSALS = new Set([
  "account_country_unsupported_currency",
  NEEDS_MERCHANT,
]);

/**
 * Where Stripe opens a recipient account only with `merchant` `card_payments` beside it —
 * `stripe_transfers` cannot be requested without it (`NEEDS_MERCHANT`). Found by
 * `scripts/probe-payout-countries.ts` for a platform in Poland: the other countries of its
 * list take a recipient alone. The account can then take cards, which this platform never
 * asks of a host, and onboarding asks for a business profile as well. The country specs say
 * nothing of it, so a country missing here is learnt from the refusal itself: the account
 * is asked for again with `merchant` and a warning names the country to add
 * (`openAccountAsStripeAllows`). The list only spares those countries the refused request.
 */
const MERCHANT_COUNTRIES: ReadonlySet<string> = new Set(["US", "CA"]);

/**
 * The countries a host's account can be opened in, each with the currency it holds:
 * `PAYOUT_COUNTRY_CURRENCIES` of the snapshot unless another table is provided — the specs
 * and `scripts/probe-payout-countries.ts`, which opens accounts in countries the snapshot
 * leaves out.
 */
export const PAYOUT_COUNTRIES = Symbol("PAYOUT_COUNTRIES");

/**
 * Hosts are Accounts v2 recipients: the platform charges the guest itself, so an account
 * only receives transfers. The platform carries fees and losses (`application`), which is
 * why a refund or lost dispute after a payout is taken back from the host by a reversal.
 */
@Injectable()
export class StripePayoutGateway extends PayoutGateway {
  private readonly logger = new Logger(StripePayoutGateway.name);

  /** `MERCHANT_COUNTRIES` and any country Stripe has asked `merchant` for since the start. */
  private readonly merchantCountries = new Set(MERCHANT_COUNTRIES);

  constructor(
    @Inject(PAYMENT_CONFIG) private readonly paymentConfig: PaymentConfig,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    @Optional()
    @Inject(PAYOUT_COUNTRIES)
    private readonly currencies: Readonly<
      Record<string, string>
    > = PAYOUT_COUNTRY_CURRENCIES,
  ) {
    super();
    this.offered = Object.keys(currencies);
  }

  /**
   * The table's countries, less any Stripe has refused to open an account in since — until
   * a restart, which reads the snapshot again.
   */
  private offered: PayoutCountry[];

  /**
   * The Express dashboard, so a host gets Stripe's own support and emails about the
   * account, and the currency of the host's country, so their own bank account takes it.
   */
  async createRecipientAccount(host: PayoutHost): Promise<string> {
    const currency = this.currencies[host.country];

    // A country the snapshot does not hold is not asked about: the list never offers it.
    if (currency === undefined) {
      throw new PayoutCountryRefusedError(host.country, "not_in_snapshot");
    }

    let account: Stripe.V2.Core.Account;

    try {
      account = await this.openAccountAsStripeAllows(host, currency);
    } catch (error) {
      // v2 answers a key it is still working on with an `idempotency_error`, which the SDK
      // types as `StripeIdempotencyError`; a v1-shaped `409` (`idempotency_key_in_use`, typed
      // as an API error) is taken too, since the v2 reference does not spell the concurrent
      // case out. A key reused with other parameters is an `idempotency_error` as well, which
      // the key rules out: it is derived from the whole body (`openAccount`).
      if (
        error instanceof Stripe.errors.StripeIdempotencyError ||
        (error instanceof Stripe.errors.StripeError &&
          error.code === "idempotency_key_in_use")
      ) {
        throw new PayoutAccountOpeningInProgressError(host.userId);
      }

      // The country itself is refused: the list is a snapshot of the country specs, not
      // Stripe's own check of an account, and the two can disagree.
      if (
        error instanceof Stripe.errors.StripeError &&
        error.code !== undefined &&
        COUNTRY_REFUSALS.has(error.code)
      ) {
        this.dropCountry(host.country);

        throw new PayoutCountryRefusedError(host.country, error.code);
      }

      throw error;
    }

    return account.id;
  }

  /**
   * A recipient alone, unless Stripe wants `merchant` beside it in the host's country: then
   * once more with it. The second request has another body and so another key; the first
   * was refused, so nothing of it was opened.
   */
  private async openAccountAsStripeAllows(
    host: PayoutHost,
    currency: string,
  ): Promise<Stripe.V2.Core.Account> {
    const withMerchant = this.merchantCountries.has(host.country);

    try {
      return await this.openAccount(host, currency, withMerchant);
    } catch (error) {
      if (
        withMerchant ||
        !(error instanceof Stripe.errors.StripeError) ||
        error.code !== NEEDS_MERCHANT
      ) {
        throw error;
      }

      // Learnt only once the second request opens the account: a country refused with
      // `merchant` as well is dropped from the list, not added to `MERCHANT_COUNTRIES`.
      const account = await this.openAccount(host, currency, true);

      this.merchantCountries.add(host.country);
      this.logger.warn(
        `Stripe opens a recipient account in ${host.country} only with merchant card payments beside it — add ${host.country} to MERCHANT_COUNTRIES`,
      );

      return account;
    }
  }

  /**
   * The countries Stripe has asked `merchant` for since the start that `MERCHANT_COUNTRIES`
   * does not list — the ones the warning names. A host never sees the difference, so
   * `scripts/probe-payout-countries.ts` reads it to report them apart from the countries
   * that open as the list expects.
   */
  learntMerchantCountries(): string[] {
    return [...this.merchantCountries]
      .filter((country) => !MERCHANT_COUNTRIES.has(country))
      .sort();
  }

  private openAccount(
    host: PayoutHost,
    currency: string,
    withMerchant: boolean,
  ): Promise<Stripe.V2.Core.Account> {
    const params = {
      contact_email: host.email,
      display_name: host.name,
      // Required before `defaults.currency` and `configuration.recipient`; lower case, as
      // the v2 reference spells it.
      identity: { country: host.country.toLowerCase() },
      dashboard: "express",
      defaults: {
        currency,
        responsibilities: {
          fees_collector: "application",
          losses_collector: "application",
        },
      },
      configuration: {
        ...(withMerchant
          ? {
              merchant: {
                capabilities: { card_payments: { requested: true } },
              },
            }
          : {}),
        recipient: {
          capabilities: {
            stripe_balance: { stripe_transfers: { requested: true } },
          },
        },
      },
      metadata: { userId: host.userId },
    } satisfies Stripe.V2.Core.AccountCreateParams;

    return this.stripe.v2.core.accounts.create(
      params,
      // The key is the body's digest, not the user alone: Stripe refuses a key it has seen
      // with other parameters, and a v2 key lives for thirty days, so a host whose first
      // account was opened but never attached and who then picks another country, or renames
      // themselves, would be refused for a month. (A request that failed is not stored: v2
      // runs it again.) The price is a second account if both requests reached Stripe, which
      // `HostAccountService.open` closes when it loses the race to the column. Opening one
      // takes Stripe over four seconds, past the client's default wait; the frontend waits
      // longer for this route (`payoutsApi.open`).
      {
        idempotencyKey: `user-${host.userId}-account-${digestOf(params)}`,
        timeout: 8_000,
      },
    );
  }

  /**
   * Every configuration the account carries has to be named, and which it carries is read
   * from Stripe rather than from its country: `merchant` may have been learnt at opening
   * (`openAccountAsStripeAllows`). Closing takes Stripe longer than the client's four
   * seconds — a sandbox timed out on nearly every close, leaving the account open — and
   * nobody waits on it (a job runs it, `HostAccountService.closeAccount`), so it takes the
   * background's time and retries. An account closed already is left alone: the retry of a
   * close whose answer was lost. The v2 reference keeps a closed account readable, as
   * `closed`; a `404` is taken as closed too, so that retry never ends in a person being
   * asked to close an account that is gone.
   */
  async closeAccount(accountId: string): Promise<void> {
    let account: Stripe.V2.Core.Account;

    try {
      account = await this.stripe.v2.core.accounts.retrieve(
        accountId,
        {},
        BACKGROUND_REQUEST,
      );
    } catch (error) {
      if (
        error instanceof Stripe.errors.StripeError &&
        error.statusCode === 404
      ) {
        return;
      }

      throw error;
    }

    if (account.closed === true) return;

    await this.stripe.v2.core.accounts.close(
      accountId,
      { applied_configurations: account.applied_configurations },
      BACKGROUND_REQUEST,
    );
  }

  /** The snapshot's countries, read from the repository rather than from Stripe. */
  transferCountries(): Promise<PayoutCountry[]> {
    return Promise.resolve(this.offered);
  }

  /** The list was wrong about `country`; the next read of it, until a restart, leaves it out. */
  private dropCountry(country: string): void {
    this.offered = this.offered.filter((offered) => offered !== country);
  }

  async createAccountSession(accountId: string): Promise<string> {
    const session = await this.stripe.accountSessions.create({
      account: accountId,
      components: {
        account_onboarding: { enabled: true },
        account_management: { enabled: true },
        payouts: { enabled: true },
        notification_banner: { enabled: true },
      },
    });

    return session.client_secret;
  }

  async transfersEnabled(accountId: string, caller: Caller): Promise<boolean> {
    const account = await this.stripe.v2.core.accounts.retrieve(
      accountId,
      { include: ["configuration.recipient"] },
      caller === "background" ? BACKGROUND_REQUEST : undefined,
    );

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
          amount: payout.amount,
          currency: payout.currency,
          destination: payout.accountId,
          source_transaction: payout.chargeId,
          transfer_group: transferGroupOf(payout.bookingId),
          description: payout.description,
          metadata: { bookingId: payout.bookingId },
        },
        {
          idempotencyKey: `booking-${payout.bookingId}-payout-${String(payout.reservation)}`,
          ...BACKGROUND_REQUEST,
        },
      );

      return { id: transfer.id, amount: heldOf(transfer) };
    } catch (error) {
      // A run racing this one under the same reservation is refused by the key while its
      // request is in flight; the transfer it sent is the answer. Two reservations never race:
      // a new one is made only after `settle` found no transfer for the last, under the lease.
      if (!(error instanceof Stripe.errors.StripeIdempotencyError)) throw error;

      const existing = await this.findTransfer(payout.bookingId);

      if (existing === null) throw error;

      return existing;
    }
  }

  async findTransfer(bookingId: string): Promise<SentTransfer | null> {
    for await (const transfer of this.stripe.transfers.list(
      { transfer_group: transferGroupOf(bookingId), limit: 100 },
      BACKGROUND_REQUEST,
    )) {
      if (transfer.metadata?.bookingId === bookingId) {
        return { id: transfer.id, amount: heldOf(transfer) };
      }
    }

    return null;
  }

  async heldOnTransfer(transferId: string): Promise<Cents> {
    return heldOf(
      await this.stripe.transfers.retrieve(transferId, {}, BACKGROUND_REQUEST),
    );
  }

  async reverseTransfer(
    transferId: string,
    amount: Cents,
    key: string,
  ): Promise<void> {
    await this.stripe.transfers.createReversal(
      transferId,
      { amount },
      { idempotencyKey: key, ...BACKGROUND_REQUEST },
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

function heldOf(transfer: Stripe.Transfer): Cents {
  return cents(transfer.amount - transfer.amount_reversed);
}

/** The body is built by `openAccount` in one order, so the same request digests the same. */
function digestOf(params: Stripe.V2.Core.AccountCreateParams): string {
  return createHash("sha256").update(JSON.stringify(params)).digest("hex");
}
