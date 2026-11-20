import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  type HttpException,
  Logger,
} from "@nestjs/common";
import {
  HostAccountStatus,
  PAYOUT_COUNTRY_UNSUPPORTED_MESSAGE,
  type AccountSession,
  type HostAccount,
  type PayoutCountries,
  type PayoutCountry,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import type { PayoutAccountHolder } from "../domain/payout.types";
import { PayoutRepository } from "../infrastructure/payout.repository";
import {
  PayoutAccountOpeningInProgressError,
  PayoutCountryRefusedError,
  PayoutGateway,
  type AccountEvent,
  type Caller,
} from "./ports/payout-gateway";
import {
  describeClose,
  PayoutJobs,
  type AccountClose,
} from "./ports/payout-jobs";
import { apiException } from "../../common/api-exception";
import { sessionNotFound } from "../../common/session-errors";

const ACCOUNT_CHANGES = new Set([
  "v2.core.account[configuration.recipient].capability_status_updated",
  "v2.core.account[requirements].updated",
]);

const ACCOUNT_UNAVAILABLE = "The payout account could not be opened";
const SESSION_UNAVAILABLE = "The onboarding session could not be opened";
const COUNTRIES_UNREADABLE =
  "The countries payouts can be sent to could not be read";

/**
 * The host's payout account: opening it, the onboarding session, and the stored flag that
 * says whether it can receive transfers — kept in step with Stripe by the account's events,
 * the host's refresh and `PayoutService`, which asks again right before a transfer.
 */
@Injectable()
export class HostAccountService {
  private readonly logger = new Logger(HostAccountService.name);

  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly payoutGateway: PayoutGateway,
    private readonly payoutJobs: PayoutJobs,
  ) {}

  async account(user: AuthenticatedUser): Promise<HostAccount> {
    return statusOf(await this.holderOf(user));
  }

  /**
   * The snapshot of Stripe's list for the platform's country, read from the repository
   * rather than from Stripe, which `open` holds a pick to.
   */
  async countries(user: AuthenticatedUser): Promise<PayoutCountries> {
    return {
      countries: await this.askProvider(user, COUNTRIES_UNREADABLE, () =>
        this.payoutGateway.transferCountries(),
      ),
    };
  }

  /**
   * Asks Stripe while onboarding is unfinished instead of waiting for the account event,
   * which may not have landed when the host comes back from the form — or, without
   * `stripe listen`, ever. An unreachable provider answers what the row says.
   */
  async refresh(user: AuthenticatedUser): Promise<HostAccount> {
    const holder = await this.holderOf(user);

    if (holder.accountId === null || holder.enabled) return statusOf(holder);

    let enabled = false;

    try {
      enabled = await this.refreshAccount(holder.accountId, "request");
    } catch (error) {
      this.logger.warn(
        `Could not ask Stripe about account ${holder.accountId}: ${String(error)}`,
      );
    }

    return {
      status: enabled
        ? HostAccountStatus.ENABLED
        : HostAccountStatus.ONBOARDING,
    };
  }

  private async holderOf(
    user: AuthenticatedUser,
  ): Promise<PayoutAccountHolder> {
    const holder = await this.payoutRepository.findHolder(user.id);

    if (holder === null) {
      throw sessionNotFound();
    }

    return holder;
  }

  /**
   * Opens the caller's account in the country they picked, written only into the empty
   * column. An account opened already is answered as it stands, its country unchanged —
   * Stripe fixes it at opening. A country the snapshot leaves out, or one Stripe refuses
   * to open an account in although the snapshot offered it, is a `400`, a second
   * request while the first is at Stripe a `409`; only the provider's failures are a `502`,
   * and the database's stay the `500` they are.
   */
  async open(
    user: AuthenticatedUser,
    country: PayoutCountry,
  ): Promise<HostAccount> {
    const holder = await this.holderOf(user);

    if (holder.accountId !== null) return statusOf(holder);

    const countries = await this.askProvider(user, COUNTRIES_UNREADABLE, () =>
      this.payoutGateway.transferCountries(),
    );

    if (!countries.includes(country)) throw countryUnsupported();

    const opened = await this.askProvider(user, ACCOUNT_UNAVAILABLE, () =>
      this.payoutGateway.createRecipientAccount({
        userId: user.id,
        email: holder.email,
        name: holder.name,
        country,
      }),
    );

    await this.payoutRepository.attachAccount(user.id, opened);
    await this.closeUnattached(user.id, opened);

    // Whichever account the column holds — this one, or one a racing request wrote first —
    // was opened a moment ago, and only Stripe's later answer enables it.
    return { status: HostAccountStatus.ONBOARDING };
  }

  /**
   * A racing request with another body — another country, another name, so another key —
   * opened an account of its own and wrote it first; this one belongs to nobody and is
   * closed. The same body replays the same account, which the column holds and is kept.
   * The close is a job (`closeAccount`), not part of the answer: it costs the host nothing,
   * and two calls to Stripe behind an opening would outlast the frontend's wait for this
   * route — a host whose account is attached would be shown an error. Queueing it is not
   * awaited either: with Redis down the queue waits for the reconnect rather than failing.
   */
  private async closeUnattached(userId: string, opened: string): Promise<void> {
    const attached =
      (await this.payoutRepository.findHolder(userId))?.accountId ?? null;

    if (attached === opened) return;

    const close = { accountId: opened, userId, attached };

    this.logger.log(`Closing ${describeClose(close)}`);
    void this.payoutJobs.scheduleAccountClose(close).catch((error: unknown) => {
      this.logger.error(
        `Could not queue the close of ${describeClose(close)} — close it in the Dashboard: ${String(error)}`,
      );
    });
  }

  /** The job behind `closeUnattached`: a failure is the queue's to retry and to log. */
  async closeAccount(close: AccountClose): Promise<void> {
    await this.payoutGateway.closeAccount(close.accountId);
    this.logger.log(`Closed ${describeClose(close)}`);
  }

  /** A host with no account yet is a `409`: the country comes first (`open`). */
  async session(user: AuthenticatedUser): Promise<AccountSession> {
    const { accountId } = await this.holderOf(user);

    if (accountId === null) {
      throw apiException(
        ConflictException,
        "PAYOUT_ACCOUNT_NOT_OPENED",
        "Choose your country to open the payout account first",
      );
    }

    return {
      clientSecret: await this.askProvider(user, SESSION_UNAVAILABLE, () =>
        this.payoutGateway.createAccountSession(accountId),
      ),
    };
  }

  /** `failure` is the step that failed, worded once for the log and the caller alike. */
  private async askProvider<T>(
    user: AuthenticatedUser,
    failure: string,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } catch (error) {
      // Not the provider failing: a second request for the same account, answered once the
      // first one is.
      if (error instanceof PayoutAccountOpeningInProgressError) {
        throw apiException(
          ConflictException,
          "PAYOUT_ACCOUNT_BEING_OPENED",
          "The payout account is being opened by another request — try again",
        );
      }

      // Not the provider failing either: the country the list offered is one Stripe will not
      // open an account in. The host picks another, which a retry of this one never fixes;
      // the warning is for a person, since the list said otherwise.
      if (error instanceof PayoutCountryRefusedError) {
        this.logger.warn(
          `${error.message} (user ${user.id}); dropped from the list until a restart`,
        );

        throw countryUnsupported();
      }

      this.logger.error(`${failure} (user ${user.id}): ${String(error)}`);

      throw apiException(
        BadGatewayException,
        "PAYOUT_ACCOUNT_UNAVAILABLE",
        failure,
      );
    }
  }

  /** A thin event says only that something changed, so the account is asked afresh. */
  async handleAccountEvent(event: AccountEvent): Promise<void> {
    if (event.accountId !== null && ACCOUNT_CHANGES.has(event.type)) {
      await this.refreshAccount(event.accountId, "background");
    }
  }

  private async refreshAccount(
    accountId: string,
    caller: Caller,
  ): Promise<boolean> {
    const enabled = await this.payoutGateway.transfersEnabled(
      accountId,
      caller,
    );

    await this.switchPayouts(accountId, enabled);

    return enabled;
  }

  /**
   * The write that switches the flag queues the host's run either way: switched on, it pays
   * what waited; switched off, it hands back the reservations standing on the host's stays,
   * which `findDuePayouts` still selects for that.
   */
  async switchPayouts(accountId: string, enabled: boolean): Promise<void> {
    const changed = await this.payoutRepository.setPayoutsEnabled(
      accountId,
      enabled,
    );

    if (changed?.switched === true) {
      await this.payoutJobs.schedulePayoutsOf(changed.userId);
    }
  }
}

/** Refused by the list, or by Stripe when the list was wrong: one code and one sentence. */
function countryUnsupported(): HttpException {
  return apiException(
    BadRequestException,
    "PAYOUT_COUNTRY_UNSUPPORTED",
    PAYOUT_COUNTRY_UNSUPPORTED_MESSAGE,
  );
}

function statusOf(holder: PayoutAccountHolder): HostAccount {
  if (holder.accountId === null) {
    return { status: HostAccountStatus.NOT_STARTED };
  }

  return {
    status: holder.enabled
      ? HostAccountStatus.ENABLED
      : HostAccountStatus.ONBOARDING,
  };
}
