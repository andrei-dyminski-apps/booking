import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { payoutCountrySchema, type PayoutCountry } from "@repo/contracts";
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

const COUNTRIES_RETRY_AFTER_MS = 10_000;

/**
 * What v2 answers an account it will not open in the country asked for, as the platform
 * asks for it. `defaults.currency` is the country's own (`readPayoutCountries`), so its
 * refusal is a fallback for a spec Stripe's check disagrees with.
 */
const COUNTRY_REFUSALS = new Set([
  "account_country_unsupported_currency",
  // The fallback for a country that needs `merchant` and is not in `MERCHANT_COUNTRIES`.
  "capability_not_available_without_other_capability",
]);

/**
 * Where Stripe opens a recipient account only with `merchant` `card_payments` beside it —
 * `stripe_transfers` cannot be requested without it (`capability_not_available_without_other_capability`).
 * Found by `scripts/probe-payout-countries.ts` for a platform in Poland: the 34 other countries
 * of its list take a recipient alone. The account can then take cards, which this platform
 * never asks of a host, and onboarding asks for a business profile as well.
 */
const MERCHANT_COUNTRIES: ReadonlySet<string> = new Set(["US", "CA"]);

/** What an account opened in `country` carries — and what closing it has to name, all of it. */
function configurationsOf(country: string): ("merchant" | "recipient")[] {
  return MERCHANT_COUNTRIES.has(country)
    ? ["merchant", "recipient"]
    : ["recipient"];
}

/** Where this platform can transfer, which of those the host is offered, and in what currency. */
export type PayoutCountryReading = {
  platformCountry: string;
  /** `supported_transfer_countries` of the platform's own spec, as Stripe lists them. */
  transferCountries: string[];
  /**
   * The currency an account opened in a country holds: its spec's `default_currency`, the
   * one a host's local bank account is in. Every country Stripe has a spec for.
   */
  currencies: ReadonlyMap<string, string>;
  offered: PayoutCountry[];
};

/**
 * `supported_transfer_countries` of the platform's own country spec — the regions Stripe
 * lets this platform send a transfer to, so an account opened anywhere else could finish
 * onboarding and still never be paid. An account is opened in its country's own currency
 * (`currencies`), so a host gives the bank account they have rather than one in the
 * platform's; Stripe converts a transfer in the stay's currency on its way in. A country
 * with no spec, or a code not spelled the way the contract spells one, is left out rather
 * than failing the list, and `scripts/probe-payout-countries.ts` compares the list with what
 * a sandbox opens. Exported for that script.
 */
export async function readPayoutCountries(
  stripe: Stripe,
): Promise<PayoutCountryReading> {
  const platform = await stripe.accounts.retrieveCurrent();

  if (platform.country === undefined) {
    throw new Error("The platform's Stripe account names no country");
  }

  const specs = new Map<string, Stripe.CountrySpec>();

  for await (const spec of stripe.countrySpecs.list({ limit: 100 })) {
    specs.set(spec.id, spec);
  }

  const own = specs.get(platform.country);

  if (own === undefined) {
    throw new Error(
      `Stripe has no country spec for the platform's country ${platform.country}`,
    );
  }

  const currencies = new Map(
    [...specs.values()].map((spec) => [spec.id, spec.default_currency]),
  );

  return {
    platformCountry: platform.country,
    transferCountries: own.supported_transfer_countries,
    currencies,
    offered: own.supported_transfer_countries.filter(
      (country) =>
        payoutCountrySchema.safeParse(country).success &&
        currencies.has(country),
    ),
  };
}

/**
 * Hosts are Accounts v2 recipients: the platform charges the guest itself, so an account
 * only receives transfers. The platform carries fees and losses (`application`), which is
 * why a refund or lost dispute after a payout is taken back from the host by a reversal.
 */
@Injectable()
export class StripePayoutGateway extends PayoutGateway {
  constructor(
    @Inject(PAYMENT_CONFIG) private readonly paymentConfig: PaymentConfig,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {
    super();
  }

  /** Stripe's answer, kept for the process: the platform's country does not change under it. */
  private reading: Promise<PayoutCountryReading> | null = null;

  /**
   * The Express dashboard, so a host gets Stripe's own support and emails about the
   * account, and the currency of the host's country, so their own bank account takes it.
   */
  async createRecipientAccount(host: PayoutHost): Promise<string> {
    const currency = (await this.read()).currencies.get(host.country);

    // No spec names the country's currency, so Stripe has nothing to open it in; the list
    // never offers such a country, and nothing is asked.
    if (currency === undefined) {
      throw new PayoutCountryRefusedError(host.country, "no_country_spec");
    }

    let account: Stripe.V2.Core.Account;

    try {
      account = await this.openAccount(host, currency);
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

      // The country itself is refused: the list is a reading of the country specs, not
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

  private openAccount(
    host: PayoutHost,
    currency: string,
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
        ...(MERCHANT_COUNTRIES.has(host.country)
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
   * Every configuration the account carries has to be named (`configurationsOf`). Closing
   * takes Stripe longer than the client's four seconds — a sandbox timed out on nearly every
   * close, leaving the account open — so it waits as long as opening does.
   */
  async closeAccount(accountId: string, country: PayoutCountry): Promise<void> {
    await this.stripe.v2.core.accounts.close(
      accountId,
      { applied_configurations: configurationsOf(country) },
      { timeout: 8_000 },
    );
  }

  /** `readPayoutCountries(...).offered`, less any country Stripe has refused to open an account in since. */
  async transferCountries(): Promise<PayoutCountry[]> {
    return (await this.read()).offered;
  }

  /**
   * One reading per process. A failed one is kept for `COUNTRIES_RETRY_AFTER_MS` only, so a
   * Stripe that is down is not asked twice a render by every host who opens the page.
   */
  private read(): Promise<PayoutCountryReading> {
    this.reading ??= readPayoutCountries(this.stripe).catch(
      (error: unknown) => {
        setTimeout(() => {
          this.reading = null;
        }, COUNTRIES_RETRY_AFTER_MS).unref();

        throw error;
      },
    );

    return this.reading;
  }

  /** The list was wrong about `country`; the next read of it, until a restart, leaves it out. */
  private dropCountry(country: string): void {
    this.reading &&= this.reading.then((reading) => ({
      ...reading,
      offered: reading.offered.filter((offered) => offered !== country),
    }));
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
