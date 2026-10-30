import {
  BadGatewayException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import {
  DisputeStatus,
  HostAccountStatus,
  NotificationType,
  payoutDueAt,
  type AccountSession,
  type HostAccount,
  type StayNotice,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { awaitsItsPayment } from "../../booking/domain/booking-status";
import { PaymentNotConfirmedYetError } from "../../booking/domain/booking.errors";
import { errorText, type SetAside } from "../../common/job-failure";
import { writeOrRefuse } from "../../common/set-aside";
import { NotificationService } from "../../notification/notification.service";
import type { PaymentEvent } from "../../payment/application/ports/payment-gateway";
import {
  formatCents,
  minCents,
  subtractCents,
  type Cents,
} from "../../payment/domain/money";
import { mayPayOut, owedToHost } from "../domain/payout";
import { SettlementInProgressError } from "../domain/payout.errors";
import type { PayoutAccountHolder, SettledStay } from "../domain/payout.types";
import { PayoutRepository } from "../infrastructure/payout.repository";
import {
  PayoutGateway,
  type AccountEvent,
  type Caller,
} from "./ports/payout-gateway";
import { PayoutJobs } from "./ports/payout-jobs";

/** A refund is not one: the booking side records it and tells this one through `StayEvents`. */
export type SettlementEvent = Extract<
  PaymentEvent,
  { kind: "disputed" | "disputeClosed" }
>;

const ACCOUNT_CHANGES = new Set([
  "v2.core.account[configuration.recipient].capability_status_updated",
  "v2.core.account[requirements].updated",
]);

/**
 * The host's half of the money: the payout account, the transfer once a stay has begun,
 * and `settle`, which reverses whatever a later refund or lost dispute removes. Every
 * transfer and reversal goes under a key, and every write is conditional on what was read.
 */
@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly payoutGateway: PayoutGateway,
    private readonly payoutJobs: PayoutJobs,
    private readonly notificationService: NotificationService,
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

  async schedule(stay: Pick<StayNotice, "bookingId" | "from">): Promise<void> {
    await this.payoutJobs.schedulePayout(
      stay.bookingId,
      payoutDueAt(stay.from),
    );
  }

  /**
   * Whether the account can receive transfers is asked of Stripe right before, not only
   * read off the flag. A refund that lands meanwhile is taken back by `settle` afterwards.
   * `accounts` caches Stripe's answer per run.
   */
  async payOut(
    bookingId: string,
    now = new Date(),
    accounts = new Map<string, boolean>(),
  ): Promise<boolean> {
    try {
      return await this.sendPayout(bookingId, now, accounts);
    } catch (error) {
      if (await this.setAsidePayoutAfter(bookingId, error)) return false;

      throw error;
    }
  }

  /** Whether this failed run set the payout aside. A failure after the transfer is not counted. */
  private async setAsidePayoutAfter(
    bookingId: string,
    error: unknown,
  ): Promise<boolean> {
    const message = errorText(error);
    let failure: SetAside | null;

    try {
      failure = await this.payoutRepository.recordPayoutFailure(
        bookingId,
        message,
        MAX_PAYOUT_ATTEMPTS,
      );
    } catch (recordError) {
      this.logger.error(
        `Could not count the failed payout of booking ${bookingId}: ${String(recordError)}`,
      );

      return false;
    }

    if (failure === null || !failure.setAside) return false;

    this.logger.error(
      `The payout of booking ${bookingId} failed ${String(failure.attempts)} times and is set aside: ${message}`,
    );
    await this.notificationService.notifyAdmins({
      type: NotificationType.PAYOUT_FAILED,
      data: { bookingId, error: message },
    });

    return true;
  }

  /**
   * Not under a lease, unlike `settle`: the stay's own job, the sweep and a host's newly
   * enabled account may all reach one stay at once, and what keeps that to one transfer is
   * the transfer itself — one idempotency key per booking with no amount in it, a lookup by
   * `transfer_group` before sending for when Stripe has forgotten the key, and
   * `recordPayout` writing only into an empty `transfer_id`. A lease here would only make
   * the losers wait, and it cannot be the settlement's, which `settle` takes below.
   */
  private async sendPayout(
    bookingId: string,
    now: Date,
    accounts: Map<string, boolean>,
  ): Promise<boolean> {
    const stay = await this.payoutRepository.findStay(bookingId);

    // Paid already: a retry of a run that failed to settle finishes the settlement.
    if (stay?.transferId != null) {
      await this.settle(bookingId);

      return false;
    }

    if (
      stay === null ||
      !mayPayOut(stay) ||
      payoutDueAt(stay.hold.stay.from) > now
    ) {
      return false;
    }

    // A stay confirmed without a payment — the seed's — has nothing to fund a transfer.
    if (stay.chargeId === null) {
      this.logger.warn(`Booking ${bookingId} has no charge to pay out from`);

      return false;
    }

    const { destination } = stay;

    if (destination.accountId === null || !destination.enabled) return false;

    // The stored flag can be stale — a capability that lapsed with no event yet.
    let enabled = accounts.get(destination.accountId);

    if (enabled === undefined) {
      enabled = await this.payoutGateway.transfersEnabled(
        destination.accountId,
        "background",
      );
      accounts.set(destination.accountId, enabled);

      if (!enabled) {
        await this.payoutRepository.setPayoutsEnabled(
          destination.accountId,
          false,
        );
        this.logger.warn(
          `Account ${destination.accountId} can no longer receive transfers, its payouts wait`,
        );
      }
    }

    if (!enabled) return false;

    const amount = owedToHost(stay);
    const sent = await this.payoutGateway.transfer({
      bookingId,
      accountId: destination.accountId,
      chargeId: stay.chargeId,
      amount,
      currency: stay.currency,
      description: describeStay(stay.hold.stay),
    });

    if (
      !(await this.payoutRepository.recordPayout(
        bookingId,
        sent.id,
        sent.amount,
      ))
    ) {
      return false;
    }

    // A retry takes the branch above and never gets here again, so the host is told now and
    // a failed settlement is thrown after the notice. The notice states what the host holds
    // after it, which is what their list shows.
    const settlement = await this.settle(bookingId).then(
      (held) => ({ settled: true as const, held }),
      (error: unknown) => ({ settled: false as const, error }),
    );

    await this.notificationService.notify(stay.hold.listingOwnerId, {
      type: NotificationType.PAYOUT_SENT,
      data: {
        ...stay.hold.stay,
        amountCents:
          (settlement.settled ? settlement.held : null) ?? sent.amount,
        currency: stay.currency,
      },
    });

    if (!settlement.settled) throw settlement.error;

    return true;
  }

  /**
   * Hands the payout back and queues its job at once rather than waiting an hour for the
   * sweep. The usual order is the host's account put right first, then the payout retried.
   */
  async retryStuckPayout(bookingId: string): Promise<void> {
    await writeOrRefuse(
      this.payoutRepository.handBackPayout(bookingId),
      () => this.payoutRepository.exists(bookingId),
      {
        conflict: `The payout of booking ${bookingId} is not stuck: it is not set aside, an open dispute holds it, or a lost dispute or a full refund leaves nothing to send`,
        notFound: `Booking ${bookingId} not found`,
      },
    );

    this.logger.log(`The payout of booking ${bookingId} was handed back`);
    await this.payoutJobs.schedulePayout(bookingId, new Date());
  }

  /** One failure is logged and left to the next run. */
  async payDuePayouts(hostId?: string): Promise<number> {
    const now = new Date();
    const accounts = new Map<string, boolean>();
    let paid = 0;

    for (const bookingId of await this.payoutRepository.findDuePayouts(
      now,
      SWEEP_BATCH,
      hostId,
    )) {
      try {
        if (await this.payOut(bookingId, now, accounts)) paid += 1;
      } catch (error) {
        // Settled by another run meanwhile: the next run finds it done.
        if (error instanceof SettlementInProgressError) {
          this.logger.warn(String(error));

          continue;
        }

        this.logger.error(
          `Could not pay out booking ${bookingId}: ${String(error)}`,
        );
      }
    }

    return paid;
  }

  /**
   * Takes back what the host holds beyond what is owed now, and answers what they hold
   * after (`null` before a transfer). The row says whether a reversal may be due; Stripe's
   * figure says how much, because a reversal whose write was lost is already off the
   * transfer. The key names both ends of the step, so a repeat is the same reversal.
   */
  async settle(bookingId: string): Promise<Cents | null> {
    return this.payoutRepository.whileSettling(
      bookingId,
      async (stay, recordReversal) => {
        if (
          stay?.transferId == null ||
          stay.paidOutAmountCents === null ||
          stay.disputeStatus === DisputeStatus.OPEN
        ) {
          return stay?.paidOutAmountCents ?? null;
        }

        const owed = owedToHost(stay);

        if (stay.paidOutAmountCents <= owed) return stay.paidOutAmountCents;

        const held = await this.payoutGateway.heldOnTransfer(stay.transferId);

        if (held > owed) {
          const excess = subtractCents(held, owed);

          await this.payoutGateway.reverseTransfer(
            stay.transferId,
            excess,
            `booking-${bookingId}-reversal-${String(held)}-${String(owed)}`,
          );
          this.logger.log(
            `Took back ${formatCents(excess)} of the payout of booking ${bookingId}`,
          );
        }

        const left = minCents(held, owed);

        // Written from outside the lease; the next settlement reads Stripe's figure again.
        if (!(await recordReversal(stay.paidOutAmountCents, left))) {
          this.logger.warn(
            `The payout of booking ${bookingId} changed outside the settlement lock while it was being reversed`,
          );

          return null;
        }

        return left;
      },
    );
  }

  async handleSettlementEvent(event: SettlementEvent): Promise<void> {
    const stay = await this.payoutRepository.findStayByPayment(event.paymentId);

    // The dispute's news came before the payment's: handled once the stay is confirmed.
    if (stay !== null && awaitsItsPayment(stay)) {
      throw new PaymentNotConfirmedYetError(event.paymentId);
    }

    // A late payment or `stripe trigger`'s: no stay was confirmed with it.
    if (stay === null || !stay.paid) return;

    switch (event.kind) {
      case "disputed":
        return this.openDispute(stay);
      case "disputeClosed":
        return this.closeDispute(stay, event.won);
    }
  }

  /** A thin event says only that something changed, so the account is asked afresh. */
  async handleAccountEvent(event: AccountEvent): Promise<void> {
    if (event.accountId !== null && ACCOUNT_CHANGES.has(event.type)) {
      await this.refreshAccount(event.accountId, "background");
    }
  }

  /** The write that switches transfers on queues the host's due payouts. */
  private async refreshAccount(
    accountId: string,
    caller: Caller,
  ): Promise<boolean> {
    const enabled = await this.payoutGateway.transfersEnabled(
      accountId,
      caller,
    );
    const changed = await this.payoutRepository.setPayoutsEnabled(
      accountId,
      enabled,
    );

    if (changed?.newlyEnabled === true) {
      await this.payoutJobs.schedulePayoutsOf(changed.userId);
    }

    return enabled;
  }

  /** Only the write that opened the dispute tells the host. */
  private async openDispute(stay: SettledStay): Promise<void> {
    if (
      !(await this.payoutRepository.setDisputeStatus(
        stay.bookingId,
        DisputeStatus.OPEN,
      ))
    ) {
      return;
    }

    await this.notificationService.notify(stay.hold.listingOwnerId, {
      type: NotificationType.PAYMENT_DISPUTED,
      data: stay.hold.stay,
    });
  }

  private async closeDispute(stay: SettledStay, won: boolean): Promise<void> {
    await this.payoutRepository.setDisputeStatus(
      stay.bookingId,
      won ? DisputeStatus.WON : DisputeStatus.LOST,
    );

    if (won) {
      await this.payoutJobs.schedulePayout(stay.bookingId, new Date());
    } else {
      await this.settle(stay.bookingId);
    }
  }
}

/** About a day of the hourly sweep; a host is paid by the day, so nothing shorter buys anything. */
export const MAX_PAYOUT_ATTEMPTS = 24;

/** Each stay is up to three calls to Stripe, one after another. */
const SWEEP_BATCH = 100;

function describeStay(stay: StayNotice): string {
  return `${stay.listingTitle}, ${stay.from} – ${stay.to}`;
}
