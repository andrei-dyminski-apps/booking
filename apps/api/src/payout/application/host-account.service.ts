import {
  BadGatewayException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import {
  HostAccountStatus,
  type AccountSession,
  type HostAccount,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import type { PayoutAccountHolder } from "../domain/payout.types";
import { PayoutRepository } from "../infrastructure/payout.repository";
import {
  PayoutGateway,
  type AccountEvent,
  type Caller,
} from "./ports/payout-gateway";
import { PayoutJobs } from "./ports/payout-jobs";

const ACCOUNT_CHANGES = new Set([
  "v2.core.account[configuration.recipient].capability_status_updated",
  "v2.core.account[requirements].updated",
]);

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
    const holder = await this.holderOf(user);

    if (holder.accountId === null) {
      return { status: HostAccountStatus.NOT_STARTED };
    }

    return {
      status: holder.enabled
        ? HostAccountStatus.ENABLED
        : HostAccountStatus.ONBOARDING,
    };
  }

  /**
   * Asks Stripe while onboarding is unfinished instead of waiting for the account event,
   * which may not have landed when the host comes back from the form — or, without
   * `stripe listen`, ever. An unreachable provider answers what the row says.
   */
  async refresh(user: AuthenticatedUser): Promise<HostAccount> {
    const holder = await this.holderOf(user);

    if (holder.accountId === null || holder.enabled) return this.account(user);

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
      throw new UnauthorizedException("Session no longer exists");
    }

    return holder;
  }

  /**
   * Opens the caller's account the first time, written only into the empty column. Only
   * the provider's failures are a `502`; the database's stay the `500` they are.
   */
  async session(user: AuthenticatedUser): Promise<AccountSession> {
    const holder = await this.holderOf(user);
    let accountId = holder.accountId;

    if (accountId === null) {
      const opened = await this.askProvider(user, () =>
        this.payoutGateway.createRecipientAccount({
          userId: user.id,
          email: holder.email,
          name: holder.name,
        }),
      );

      await this.payoutRepository.attachAccount(user.id, opened);
      accountId =
        (await this.payoutRepository.findHolder(user.id))?.accountId ?? opened;
    }

    return {
      clientSecret: await this.askProvider(user, () =>
        this.payoutGateway.createAccountSession(accountId),
      ),
    };
  }

  private async askProvider<T>(
    user: AuthenticatedUser,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.error(
        `Could not open the payout session of user ${user.id}: ${String(error)}`,
      );

      throw new BadGatewayException("The payout account could not be opened");
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
