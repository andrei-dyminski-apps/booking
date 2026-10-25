import {
  BadGatewayException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import {
  HostAccountStatus,
  NotificationType,
  payoutDueAt,
  type AccountSession,
  type HostAccount,
  type StayNotice,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { NotificationService } from "../../notification/notification.service";
import type { PaymentEvent } from "../../payment/application/ports/payment-gateway";
import { roundCents, toCents } from "../../payment/domain/money";
import { mayPayOut, owedToHost } from "../domain/payout";
import { HostPayoutQueue } from "../infrastructure/host-payout.queue";
import {
  PayoutRepository,
  type PayoutAccountHolder,
  type SettledStay,
} from "../infrastructure/payout.repository";
import { PayoutGateway, type AccountEvent } from "./ports/payout-gateway";

/**
 * The webhook events this service settles; `PayoutEventHandler` hands them over. A refund
 * is not one of them: recording it, and cancelling a stay it refunded in full, are the
 * booking side's, and it tells this service through `StayLifecycle` once they are done.
 */
export type SettlementEvent = Extract<
  PaymentEvent,
  { kind: "disputed" | "disputeClosed" }
>;

/** The account events that can change whether a host can be paid. */
const ACCOUNT_CHANGES = new Set([
  "v2.core.account[configuration.recipient].capability_status_updated",
  "v2.core.account[requirements].updated",
]);

/**
 * The host's half of the money: the payout account, the transfer of their share once a stay
 * has begun, and what changes that share afterwards — a refund or a dispute. The guest pays
 * the platform; the host is paid `PAYOUT_DELAY_HOURS` after check-in by a separate transfer,
 * and `settle` takes back by a reversal whatever a later refund or lost dispute removes. A
 * host who cannot be paid yet is booked as usual; their payouts wait. Every transfer and
 * reversal goes under a key, and every write is conditional on what the run read.
 */
@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly payoutGateway: PayoutGateway,
    private readonly hostPayoutQueue: HostPayoutQueue,
    private readonly notificationService: NotificationService,
  ) {}

  /** Where the caller stands with payouts, as the row says it. */
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
   * Where the caller stands, asked of Stripe while onboarding is unfinished rather than only
   * waiting for the account event: the screen a host comes back to after the form is where
   * they look first, and the event may not have landed — or, on a laptop without
   * `stripe listen`, may never land at all. What waited for the account is paid by a job.
   * A provider that cannot be reached answers what the row says.
   */
  async refresh(user: AuthenticatedUser): Promise<HostAccount> {
    const holder = await this.holderOf(user);

    if (holder.accountId === null || holder.enabled) return this.account(user);

    let enabled = false;

    try {
      enabled = await this.refreshAccount(holder.accountId);
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
   * A session for Stripe's embedded components, opening the caller's account the first time
   * — named after the user at Stripe, written only into the empty column.
   */
  async session(user: AuthenticatedUser): Promise<AccountSession> {
    const holder = await this.holderOf(user);

    try {
      let accountId = holder.accountId;

      if (accountId === null) {
        const opened = await this.payoutGateway.createRecipientAccount({
          userId: user.id,
          email: holder.email,
          name: holder.name,
        });

        await this.payoutRepository.attachAccount(user.id, opened);
        accountId =
          (await this.payoutRepository.findHolder(user.id))?.accountId ??
          opened;
      }

      return {
        clientSecret: await this.payoutGateway.createAccountSession(accountId),
      };
    } catch (error) {
      this.logger.error(
        `Could not open the payout session of user ${user.id}: ${String(error)}`,
      );

      throw new BadGatewayException("The payout account could not be opened");
    }
  }

  /** The job that pays a confirmed stay's host when it falls due; the sweep covers a lost one. */
  async schedule(stay: Pick<StayNotice, "bookingId" | "from">): Promise<void> {
    await this.hostPayoutQueue.schedulePayout(
      stay.bookingId,
      payoutDueAt(stay.from),
    );
  }

  /**
   * Pays the host of one stay if it is due, owed something, not held back by a dispute, and
   * their account can receive transfers — asked of Stripe right before, not only read off
   * the flag. The transfer is recorded as it was, even if a refund landed meanwhile, and
   * `settle` takes back the difference. `accounts` caches Stripe's answer per run.
   */
  async payOut(
    bookingId: string,
    now = new Date(),
    accounts = new Map<string, boolean>(),
  ): Promise<boolean> {
    const stay = await this.payoutRepository.findStay(bookingId);

    // Paid already. A run that recorded the transfer and then failed to settle it is retried
    // by its job and lands here, so the settlement it owes is finished now.
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

    // The stored flag is what the sweep reads without asking Stripe, and it can be stale: an
    // account whose capability lapsed with no event delivered yet. Money moves only on what
    // Stripe says now, and the flag is brought in line with it.
    let enabled = accounts.get(destination.accountId);

    if (enabled === undefined) {
      enabled = await this.payoutGateway.transfersEnabled(
        destination.accountId,
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
      description: describeStay(stay.hold.stay),
    });

    if (
      !(await this.payoutRepository.recordPayout(
        bookingId,
        sent.id,
        sent.amount,
      ))
    ) {
      // Another run recorded the same transfer — the key made it one.
      return false;
    }

    // The transfer is recorded, so a retry of this run takes the branch above and never
    // gets here again: the host is told now, whatever the settlement does, and a settlement
    // that failed is thrown after the notice for the job to retry.
    //
    // What the host is left holding, not what was sent: a refund that landed on the way has
    // been taken back from the transfer by now, and the notice should match their list.
    const settlement = await this.settle(bookingId).then(
      (held) => ({ settled: true as const, held }),
      (error: unknown) => ({ settled: false as const, error }),
    );

    await this.notificationService.notify(stay.hold.listingOwnerId, {
      type: NotificationType.PAYOUT_SENT,
      data: {
        ...stay.hold.stay,
        amount: (settlement.settled ? settlement.held : null) ?? sent.amount,
      },
    });

    if (!settlement.settled) throw settlement.error;

    return true;
  }

  /** Every due stay, or one host's; one failure is logged and left to the next run. */
  async payDuePayouts(hostId?: string): Promise<number> {
    const now = new Date();
    const accounts = new Map<string, boolean>();
    let paid = 0;

    for (const bookingId of await this.payoutRepository.findDuePayouts(
      now,
      hostId,
    )) {
      try {
        if (await this.payOut(bookingId, now, accounts)) paid += 1;
      } catch (error) {
        this.logger.error(
          `Could not pay out booking ${bookingId}: ${String(error)}`,
        );
      }
    }

    return paid;
  }

  /**
   * Takes back whatever the host holds of a stay beyond what they are owed now, under the
   * settlement lease, and answers what they hold afterwards (`null` before a transfer).
   * Nothing moves while a dispute is open. The reversal is named after the amount the host
   * is left with, so a repeat is the same reversal.
   */
  async settle(bookingId: string): Promise<number | null> {
    return this.payoutRepository.whileSettling(
      bookingId,
      async (stay, recordReversal) => {
        if (
          stay?.transferId == null ||
          stay.paidOutAmount === null ||
          stay.disputeStatus === "OPEN"
        ) {
          return stay?.paidOutAmount ?? null;
        }

        const owed = owedToHost(stay);

        if (stay.paidOutAmount <= owed) return stay.paidOutAmount;

        await this.payoutGateway.reverseTransfer(
          stay.transferId,
          roundCents(stay.paidOutAmount - owed),
          `booking-${bookingId}-reversal-${String(toCents(owed))}`,
        );

        // A `false` is a write from outside the lease: the reversal is out at Stripe either
        // way, and the next settlement sizes the difference from what is stored.
        if (!(await recordReversal(stay.paidOutAmount, owed))) {
          this.logger.warn(
            `The payout of booking ${bookingId} changed outside the settlement lock while it was being reversed`,
          );

          return null;
        }

        this.logger.log(
          `Took back ${String(roundCents(stay.paidOutAmount - owed))} of the payout of booking ${bookingId}`,
        );

        return owed;
      },
    );
  }

  /** A dispute, verified and looked up in the ledger by the dispatcher. */
  async handleSettlementEvent(event: SettlementEvent): Promise<void> {
    const stay = await this.payoutRepository.findStayByPayment(event.paymentId);

    // A payment this API never confirmed a stay with: a late one is refunded by the webhook
    // itself and recorded there, and `stripe trigger` sends payments nobody opened.
    if (stay === null || !stay.paid) return;

    switch (event.kind) {
      case "disputed":
        return this.openDispute(stay);
      case "disputeClosed":
        return this.closeDispute(stay, event.won);
    }
  }

  /**
   * One of Stripe's account events, from the inbox. Whether the account can receive
   * transfers is asked afresh — the delivery says only that something changed — and the
   * account that has just become able to is paid what was waiting for it.
   */
  async handleAccountEvent(event: AccountEvent): Promise<void> {
    if (event.accountId !== null && ACCOUNT_CHANGES.has(event.type)) {
      await this.refreshAccount(event.accountId);
    }
  }

  /**
   * What Stripe says of an account's transfers, written down; the write that switched them
   * on queues the host's due payouts rather than paying them here.
   */
  private async refreshAccount(accountId: string): Promise<boolean> {
    const enabled = await this.payoutGateway.transfersEnabled(accountId);
    const changed = await this.payoutRepository.setPayoutsEnabled(
      accountId,
      enabled,
    );

    if (changed?.newlyEnabled === true) {
      await this.hostPayoutQueue.schedulePayoutsOf(changed.userId);
    }

    return enabled;
  }

  /** The payout waits for the outcome; only the write that opened the dispute tells the host. */
  private async openDispute(stay: SettledStay): Promise<void> {
    if (
      !(await this.payoutRepository.setDisputeStatus(stay.bookingId, "OPEN"))
    ) {
      return;
    }

    await this.notificationService.notify(stay.hold.listingOwnerId, {
      type: NotificationType.PAYMENT_DISPUTED,
      data: stay.hold.stay,
    });
  }

  /**
   * Won, the stay's payout job is queued (the job already waiting, for a stay not yet due).
   * Lost, the host's share went with the money: a transfer already sent is reversed.
   */
  private async closeDispute(stay: SettledStay, won: boolean): Promise<void> {
    await this.payoutRepository.setDisputeStatus(
      stay.bookingId,
      won ? "WON" : "LOST",
    );

    if (won) {
      await this.hostPayoutQueue.schedulePayout(stay.bookingId, new Date());
    } else {
      await this.settle(stay.bookingId);
    }
  }
}

/** What a host reads beside a transfer in their payouts list. */
function describeStay(stay: StayNotice): string {
  return `${stay.listingTitle}, ${stay.from} – ${stay.to}`;
}
