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
  addCents,
  formatCents,
  minCents,
  NO_CENTS,
  subtractCents,
  type Cents,
} from "../../payment/domain/money";
import { mayPayOut, owedToHost } from "../domain/payout";
import { SettlementInProgressError } from "../domain/payout.errors";
import type {
  PayoutAccountHolder,
  SettledStay,
  SettlementWrites,
} from "../domain/payout.types";
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
      // Another run holds the stay: nothing failed, and the lease runs out on its own.
      if (error instanceof SettlementInProgressError) throw error;

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

    // Stripe may hold the transfer after all: recorded, the payout is no longer stuck, the
    // record takes the stay off the list, and nobody is asked to retry money that was sent.
    if (await this.releaseReservation(bookingId, "it is set aside")) {
      this.logger.log(
        `The payout of booking ${bookingId} was found sent while being set aside, and is recorded`,
      );

      return true;
    }

    await this.notificationService.notifyAdmins({
      type: NotificationType.PAYOUT_FAILED,
      data: { bookingId, error: message },
    });

    return true;
  }

  /**
   * Releases the reservation of a payout that cannot go out, so its fees do not stay withheld
   * from money nobody sent and another payout can keep them back. The next run, or the admin's
   * retry, reserves afresh.
   *
   * Called when the payout is set aside for a person or waits on an account that cannot
   * receive transfers. An open dispute is `openDispute`'s, through `settle`.
   *
   * If Stripe already holds the transfer, it is recorded instead of released, and this answers
   * `true`. A failure is only logged: the payout waits either way, and the next run of an
   * unsendable stay tries again.
   */
  private async releaseReservation(
    bookingId: string,
    reason: string,
  ): Promise<boolean> {
    try {
      return (await this.settleStay(bookingId, reason)).recovered;
    } catch (error) {
      this.logger.warn(
        `Could not release the payout reserved for booking ${bookingId} (${reason}): ${String(error)}`,
      );

      return false;
    }
  }

  /**
   * Releases the reservation of a stay whose host cannot be sent a transfer. A stay with no
   * reservation is left alone, so it does not take the settlement's lease for nothing.
   */
  private async releaseIfAccountCannotReceive(
    stay: SettledStay,
  ): Promise<void> {
    if (stay.payoutReservedCents === null) return;

    await this.releaseReservation(
      stay.bookingId,
      "the host's account cannot receive transfers",
    );
  }

  /**
   * Two steps. The reservation fixes what is sent and kept back, in a short transaction under
   * the host's lock, so two stays of one host cannot keep back the same fee. The transfer then
   * goes out under the settlement's lease, never a transaction: the stay's own job, the sweep
   * and a host's newly enabled account may all reach one stay at once, and what keeps that to
   * one transfer is the transfer itself — an idempotency key per reservation, a lookup by
   * `transfer_group` before sending for when Stripe has forgotten the key, and the record
   * written only into a reserved stay not paid out. A retry of a reservation sends its amount
   * under its key; a reservation made afresh after a release is a new request with a key of
   * its own. `settle` runs after the lease, which it takes itself.
   */
  private async sendPayout(
    bookingId: string,
    now: Date,
    accounts: Map<string, boolean>,
  ): Promise<boolean> {
    const stay = await this.payoutRepository.findStay(bookingId);

    // Paid already: a retry of a run that failed to settle finishes the settlement.
    if (stay?.paidOut === true) {
      await this.settle(bookingId);

      return false;
    }

    if (stay === null) return false;

    // A refund or a dispute since the reservation: `settle` hands it back.
    if (!mayPayOut(stay)) {
      if (stay.payoutReservedCents !== null) await this.settle(bookingId);

      return false;
    }

    if (payoutDueAt(stay.hold.stay.from) > now) return false;

    // A stay confirmed without a payment — the seed's — has nothing to fund a transfer.
    if (stay.chargeId === null) {
      this.logger.warn(`Booking ${bookingId} has no charge to pay out from`);

      return false;
    }

    const { destination } = stay;

    if (destination.accountId === null || !destination.enabled) {
      await this.releaseIfAccountCannotReceive(stay);

      return false;
    }

    // The stored flag can be stale — a capability that lapsed with no event yet.
    let enabled = accounts.get(destination.accountId);

    if (enabled === undefined) {
      enabled = await this.payoutGateway.transfersEnabled(
        destination.accountId,
        "background",
      );
      accounts.set(destination.accountId, enabled);

      if (!enabled) {
        await this.switchPayouts(destination.accountId, false);
        this.logger.warn(
          `Account ${destination.accountId} can no longer receive transfers, its payouts wait`,
        );
      }
    }

    if (!enabled) {
      await this.releaseIfAccountCannotReceive(stay);

      return false;
    }

    const owed = owedToHost(stay);
    const hostId = stay.hold.listingOwnerId;
    const accountId = destination.accountId;
    const { chargeId } = stay;
    // Fixed first, in a short transaction under the host's lock; the transfer goes out after
    // it, so no connection waits on Stripe. The fees the host owes come off first — nothing
    // of a cancelled stay was ever paid to them, so their earnings are where it is taken from.
    const reserved = await this.payoutRepository.reservePayout(
      bookingId,
      hostId,
      (owedFees) => {
        const withheld = minCents(owed, owedFees);

        return { send: subtractCents(owed, withheld), withheld };
      },
    );

    if (!reserved) return false;

    const recorded = await this.payoutRepository.whilePayingOut(
      bookingId,
      async (current, record) => {
        // Recorded by another run, or handed back by a settlement since the reservation.
        if (current?.payoutReservedCents == null || current.paidOut) {
          return null;
        }

        // A refund or a dispute since the stay was read: the reservation was sized from what
        // it owed before, and a transfer of it would only be reversed again. `settle` hands it
        // back after the lease, and the next run reserves afresh.
        if (
          !mayPayOut(current) ||
          addCents(current.payoutReservedCents, current.feeWithheldCents) >
            owedToHost(current)
        ) {
          return STALE_RESERVATION;
        }

        const send = current.payoutReservedCents;
        const transfer =
          send > 0
            ? await this.payoutGateway.transfer({
                bookingId,
                accountId,
                chargeId,
                amount: send,
                reservation: current.payoutReservations,
                currency: stay.currency,
                description: describeStay(stay.hold.stay),
              })
            : null;
        const sent = transfer?.amount ?? NO_CENTS;

        return (await record({ transferId: transfer?.id ?? null, sent }))
          ? { reserved: send, sent, withheld: current.feeWithheldCents }
          : null;
      },
    );

    if (recorded === STALE_RESERVATION) {
      this.logger.log(
        `The payout reserved for booking ${bookingId} is more than the stay owes now, and goes back to its settlement`,
      );
      await this.settle(bookingId);

      return false;
    }

    if (recorded === null) return false;

    // A retry takes the branch above and never gets here again, so the host is told now and
    // a failed settlement is thrown after the notice. The notice states what the host holds
    // after it, which is what their list shows.
    const settlement = await this.settle(bookingId).then(
      (held) => ({ settled: true as const, held }),
      (error: unknown) => ({ settled: false as const, error }),
    );

    await this.tellPaidOut(
      stay,
      recorded,
      settlement.settled ? settlement.held : null,
    );

    if (!settlement.settled) throw settlement.error;

    return true;
  }

  /**
   * The host hears of a payout recorded, by whichever run recorded it — the payout's own, or a
   * settlement that found a transfer no run wrote down — with what they hold after the
   * settlement (`held`, the transfer as recorded when that is unknown). A transfer found by its
   * group rather than sent now — one sent before reservations, or an earlier reservation's
   * that Stripe made after its run gave up — can differ from what was reserved: `settle` takes
   * back anything beyond what is owed, and a shortfall nothing sends, so every admin is told.
   */
  private async tellPaidOut(
    stay: SettledStay,
    payout: { reserved: Cents; sent: Cents; withheld: Cents },
    held: Cents | null,
  ): Promise<void> {
    const { bookingId } = stay;
    const { reserved, sent } = payout;

    if (sent > reserved) {
      this.logger.warn(
        `The payout of booking ${bookingId} found a transfer of ${formatCents(sent)} where ${formatCents(reserved)} was reserved`,
      );
    } else if (sent < reserved) {
      this.logger.error(
        `The payout of booking ${bookingId} found a transfer of ${formatCents(sent)} where ${formatCents(reserved)} was reserved: its host is owed ${formatCents(subtractCents(reserved, sent))} more, which no run sends`,
      );
      await this.notificationService.notifyAdmins({
        type: NotificationType.PAYOUT_SHORTFALL,
        data: {
          bookingId,
          reservedCents: reserved,
          sentCents: sent,
          currency: stay.currency,
        },
      });
    }

    await this.notificationService.notify(stay.hold.listingOwnerId, {
      type: NotificationType.PAYOUT_SENT,
      data: {
        ...stay.hold.stay,
        amountCents: held ?? sent,
        withheldCents: payout.withheld,
        currency: stay.currency,
      },
    });
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
   * Takes back what the host holds beyond what is owed now, and answers what the transfer
   * holds after (`null` before the payout). What the host holds is the transfer plus what the
   * payout kept back towards their fees: a later refund comes out of the transfer first, and
   * whatever the transfer cannot cover goes back onto the fees as debt rather than becoming a
   * negative transfer. The row says whether a reversal may be due; Stripe's figure says how
   * much, because a reversal whose write was lost is already off the transfer. The key names
   * both ends of the step, so a repeat is the same reversal.
   */
  async settle(bookingId: string): Promise<Cents | null> {
    return (await this.settleStay(bookingId, null)).held;
  }

  /**
   * `settle`, also answering whether it recorded a transfer a run sent and never wrote down
   * (`recovered`) — the host is told of that payout here, after the lease, as `sendPayout`
   * tells of its own: with what they hold after the settlement, and before a settlement that
   * failed is thrown, since no later run finds the payout unrecorded again. `abandoning` is
   * the reason a reservation standing cannot go out (`settleReservation`).
   */
  private async settleStay(
    bookingId: string,
    abandoning: string | null,
  ): Promise<{ held: Cents | null; recovered: boolean }> {
    const outcome = await this.payoutRepository.whileSettling(
      bookingId,
      async (read, writes) => {
        const { stay, recovered } =
          read !== null && !read.paidOut && read.payoutReservedCents !== null
            ? await this.settleReservation(
                read,
                read.payoutReservedCents,
                writes,
                abandoning,
              )
            : { stay: read, recovered: null };

        try {
          return {
            held: await this.takeBack(bookingId, stay, writes),
            recovered,
            failure: null,
          };
        } catch (error) {
          if (recovered === null) throw error;

          return { held: null, recovered, failure: { error } };
        }
      },
    );

    if (outcome.recovered !== null) {
      await this.tellPaidOut(
        outcome.recovered.stay,
        outcome.recovered,
        outcome.held,
      );
    }

    if (outcome.failure !== null) throw outcome.failure.error;

    return { held: outcome.held, recovered: outcome.recovered !== null };
  }

  /** The settlement proper: what the host holds beyond what is owed comes back. */
  private async takeBack(
    bookingId: string,
    stay: SettledStay | null,
    writes: SettlementWrites,
  ): Promise<Cents | null> {
    if (
      stay === null ||
      !stay.paidOut ||
      stay.paidOutAmountCents === null ||
      stay.disputeStatus === DisputeStatus.OPEN
    ) {
      return stay?.paidOutAmountCents ?? null;
    }

    const owed = owedToHost(stay);
    const paidOut = stay.paidOutAmountCents;
    const withheld = stay.feeWithheldCents;

    if (addCents(paidOut, withheld) <= owed) return paidOut;

    // What the transfer may still hold once the withheld is counted; the withheld stays
    // kept back as far as what is owed covers it.
    const transferOwed = subtractCents(owed, minCents(owed, withheld));
    let left = paidOut;

    if (stay.transferId !== null && paidOut > transferOwed) {
      const held = await this.payoutGateway.heldOnTransfer(stay.transferId);

      if (held > transferOwed) {
        const excess = subtractCents(held, transferOwed);

        await this.payoutGateway.reverseTransfer(
          stay.transferId,
          excess,
          `booking-${bookingId}-reversal-${String(held)}-${String(transferOwed)}`,
        );
        this.logger.log(
          `Took back ${formatCents(excess)} of the payout of booking ${bookingId}`,
        );
      }

      left = minCents(held, transferOwed);
    }

    const keptBack = minCents(withheld, owed);

    // Written from outside the lease; the next settlement reads Stripe's figure again.
    if (
      !(await writes.settlement(
        { paidOut, withheld },
        { paidOut: left, withheld: keptBack },
      ))
    ) {
      this.logger.warn(
        `The payout of booking ${bookingId} changed outside the settlement lock while it was being reversed`,
      );

      return null;
    }

    if (keptBack < withheld) {
      this.logger.log(
        `Handed ${formatCents(subtractCents(withheld, keptBack))} kept back of booking ${bookingId} back to its host's fees`,
      );
    }

    return left;
  }

  /**
   * A reservation the settlement found unrecorded — its run died after Stripe, or a refund
   * came between the two. The lease says no transfer is on its way, so Stripe's answer is the
   * whole truth: a transfer is recorded and settled like any payout; with none, a reservation
   * the stay no longer covers is handed back, to be reserved afresh by the next payout run —
   * and so is one an open dispute holds, which may take months to close, and any reservation
   * the payout is `abandoning` — the reason it cannot go out. A reservation with no reason to
   * go back is left to its payout run without asking Stripe: the run sends under the same key,
   * or finds the transfer by its group, and records it either way. Answers the stay as
   * recorded (`null` when there is nothing to settle) and, for a transfer found and recorded,
   * the payout to tell its host of.
   */
  private async settleReservation(
    stay: SettledStay,
    reserved: Cents,
    writes: SettlementWrites,
    abandoning: string | null,
  ): Promise<{
    stay: SettledStay | null;
    recovered: RecoveredPayout | null;
  }> {
    const nothing = { stay: null, recovered: null };
    const why =
      abandoning ??
      (stay.disputeStatus === DisputeStatus.OPEN
        ? "a dispute holds the payout"
        : addCents(reserved, stay.feeWithheldCents) > owedToHost(stay)
          ? "the stay owes its host less now"
          : null);

    if (why === null) return nothing;

    const transfer =
      reserved > 0
        ? await this.payoutGateway.findTransfer(stay.bookingId)
        : null;

    if (transfer !== null) {
      if (
        !(await writes.payout({
          transferId: transfer.id,
          sent: transfer.amount,
        }))
      ) {
        return nothing;
      }

      this.logger.log(
        `Recorded the payout of booking ${stay.bookingId}, sent by a run that never wrote it`,
      );

      return {
        stay: {
          ...stay,
          paidOut: true,
          transferId: transfer.id,
          paidOutAmountCents: transfer.amount,
          payoutReservedCents: null,
        },
        recovered: {
          stay,
          reserved,
          sent: transfer.amount,
          withheld: stay.feeWithheldCents,
        },
      };
    }

    if (
      await writes.release({ send: reserved, withheld: stay.feeWithheldCents })
    ) {
      this.logger.log(
        `Handed back the payout reserved for booking ${stay.bookingId}: ${why}`,
      );
    }

    return nothing;
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
  private async switchPayouts(
    accountId: string,
    enabled: boolean,
  ): Promise<void> {
    const changed = await this.payoutRepository.setPayoutsEnabled(
      accountId,
      enabled,
    );

    if (changed?.switched === true) {
      await this.payoutJobs.schedulePayoutsOf(changed.userId);
    }
  }

  /**
   * Only the write that opened the dispute tells the host, before anything that can throw. A
   * reservation standing is handed back by `settle`, which reads the stay under the lease
   * rather than trusting `stay` — one made since the read is handed back too — and on every
   * delivery, not only the opening one: no payout run reads a disputed stay until the dispute
   * closes, so a lease another run holds is thrown, and the event comes again uncounted
   * instead of leaving the reservation standing for months.
   */
  private async openDispute(stay: SettledStay): Promise<void> {
    if (
      await this.payoutRepository.setDisputeStatus(
        stay.bookingId,
        DisputeStatus.OPEN,
      )
    ) {
      await this.notificationService.notify(stay.hold.listingOwnerId, {
        type: NotificationType.PAYMENT_DISPUTED,
        data: stay.hold.stay,
      });
    }

    await this.settle(stay.bookingId);
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

/** What a transfer's lease answers for a reservation the stay no longer covers. */
const STALE_RESERVATION = "stale";

/** A transfer a settlement found for a reservation no run recorded, and what it reserved. */
type RecoveredPayout = {
  stay: SettledStay;
  reserved: Cents;
  sent: Cents;
  withheld: Cents;
};

/** About a day of the hourly sweep; a host is paid by the day, so nothing shorter buys anything. */
export const MAX_PAYOUT_ATTEMPTS = 24;

/** Each stay is up to three calls to Stripe, one after another. */
const SWEEP_BATCH = 100;

function describeStay(stay: StayNotice): string {
  return `${stay.listingTitle}, ${stay.from} – ${stay.to}`;
}
