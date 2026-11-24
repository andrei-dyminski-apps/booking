import { Injectable } from "@nestjs/common";
import {
  ACCOUNT_OPEN_MATTERS,
  BookingStatus,
  DELETED_USER_NAME,
  DisputeStatus,
  Role,
  StayParty,
  owedToHost,
  stayDay,
  type OpenMatter,
} from "@repo/contracts";
import { tz } from "@date-fns/tz";
import { startOfDay, subDays } from "date-fns";
import type { Prisma } from "../generated/prisma/client";
import { toIsoDate } from "../common/iso-date";
import { ACTIVE_STATUSES } from "../booking/domain/booking-status";
import {
  againstListingsOf,
  lockHostFees,
  owedFeesWhere,
} from "../booking/infrastructure/booking-where";
import { toStayMoney } from "../booking/infrastructure/stay-rows";
import { STILL_OFFERED } from "../listing/listing.repository";
import { PrismaService } from "../prisma/prisma.service";

/** The account is not there to erase: gone, blocked or erased already since its token was signed. */
export class AccountGoneError extends Error {
  constructor(userId: string) {
    super(`User ${userId} has no account left to erase`);
    this.name = "AccountGoneError";
  }
}

/** The account is the last admin's: the site would be left with nobody to run it. */
export class LastAdminError extends Error {
  constructor(userId: string) {
    super(`User ${userId} is the last active admin`);
    this.name = "LastAdminError";
  }
}

/**
 * What is still open on an account: every matter, in the contract's order, and which of them
 * are open on each side of its stays — as their guest and as the host of the listing — so
 * the refusal can point at the half of the stays that holds each.
 */
export type OpenMatters = {
  open: readonly [OpenMatter, ...OpenMatter[]];
  asGuest: readonly OpenMatter[];
  asHost: readonly OpenMatter[];
};

/** Something is still open on the account — every matter that is, in the contract's order. */
export class OpenMattersError extends Error {
  constructor(
    userId: string,
    readonly matters: OpenMatters,
  ) {
    super(`User ${userId} still has open: ${matters.open.join(", ")}`);
    this.name = "OpenMattersError";
  }
}

/** The one key every erasure of admins queues on, so the last two cannot both go at once. */
const ADMINS_LOCK = "admins:erasure";

/**
 * The erasure of an account — erasing the person, not the history. One transaction reaches
 * into every table an account has rows in, because the halves are one decision: an account
 * scrubbed with its sessions alive, or its listings left on offer, is worse than either
 * write alone. That is why it is a repository of its own rather than a method of
 * `UserRepository`, the way `LookupRepository` reads several tables for one question; no
 * row of another table is mapped here.
 *
 * **The locks are the money paths' own, taken in their order**, so nothing those paths can
 * still open lands between the checks and the scrub:
 *
 *  1. the host's fee lock (`lockHostFees`), which every write that changes what a host owes
 *     takes first — a payout's reservation, a release, a settlement, a waiver;
 *  2. the account's own row, `FOR UPDATE` — a hold (`BookingRepository.create`), a listing
 *     (`ListingRepository.create`) and a waitlist entry read it `FOR KEY SHARE` or `FOR
 *     UPDATE` and refuse it erased, so one that lands first is seen by the checks below and
 *     one that comes after is refused;
 *  3. its listings still on offer, `FOR UPDATE` and in id order — the lock a hold of one of
 *     them takes first, so a hold being taken commits before the checks read the stays.
 *
 * A hold takes the listing first and the guest second, and this takes the account first
 * and its own listings second — never a listing a hold by this account could be taking,
 * since nobody books their own — so the two orders never meet in a cycle.
 *
 * What runs under a lease rather than a lock — a cancellation's refund, a settlement, a
 * transfer — leaves a mark on the row before it calls the provider (`refund_owed_cents`,
 * `payout_reserved_cents`): a refund owed is read as still open to its guest, and a
 * reservation is a payout on its way, which needs nobody once it is.
 *
 * **Money owed to the account does not hold the erasure while it can still be paid.** A
 * payout needs no name and no address, only the connected account the row keeps, so the
 * erasure leaves `payouts_enabled_at` as it is and the payout sweep goes on paying what
 * comes due — a share of a stay cancelled months ahead included. What it refuses is money
 * nothing could pay any more once nobody can sign in to set it up: a share owed to a host
 * whose payouts are not enabled, or one already set aside after failing. A refund owed to
 * the guest of a stay the account hosted is the guest's money and goes back without the
 * host; what it leaves of the host's share is counted as that share.
 */
@Injectable()
export class AccountRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Erases the account or refuses to: `OpenMattersError` while something is open,
   * `LastAdminError` for the last admin, `AccountGoneError` for an account no session may
   * act for any more. `placeholderHash` is what the password hash becomes — computed by the
   * caller, outside the transaction, since an argon2 hash costs what it costs.
   */
  async erase(userId: string, placeholderHash: string): Promise<void> {
    await this.prismaService.$transaction(async (tx) => {
      await lockHostFees(tx, userId);

      const [account] = await tx.$queryRaw<LockedAccount[]>`
        SELECT role, blocked_at, deleted_at, payouts_enabled_at FROM users
        WHERE id = ${userId}::uuid FOR UPDATE
      `;

      if (
        account === undefined ||
        account.blocked_at !== null ||
        account.deleted_at !== null
      ) {
        throw new AccountGoneError(userId);
      }

      if (account.role === Role.ADMIN) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ADMINS_LOCK}, 0))`;

        // After the lock: two admins erasing at once queue here, and the second counts
        // without the first.
        const others = await tx.user.count({
          where: {
            role: Role.ADMIN,
            blockedAt: null,
            deletedAt: null,
            id: { not: userId },
          },
        });

        if (others === 0) throw new LastAdminError(userId);
      }

      await tx.$queryRaw`
        SELECT id FROM listings
        WHERE owner_id = ${userId}::uuid AND deleted_at IS NULL
        ORDER BY id FOR UPDATE
      `;

      const { open, asGuest, asHost } = await openMatters(tx, userId, {
        now: new Date(),
        payoutsEnabled: account.payouts_enabled_at !== null,
      });
      const [first, ...rest] = open;

      if (first !== undefined) {
        throw new OpenMattersError(userId, {
          open: [first, ...rest],
          asGuest,
          asHost,
        });
      }

      const now = new Date();

      await tx.user.update({
        where: { id: userId },
        data: {
          name: DELETED_USER_NAME,
          email: placeholderEmail(userId),
          passwordHash: placeholderHash,
          emailVerifiedAt: null,
          emailUndeliverableAt: null,
          emailDeliveryRestoredAt: null,
          confirmationHash: null,
          confirmationExpiresAt: null,
          mutedMailGroups: [],
          deletedAt: now,
          // `stripe_account_id` and `payouts_enabled_at` stay: the provider's records are
          // reconciled against the first, and a share still owed is paid out by both.
        },
      });

      // Every session at once — deleted rather than revoked, as a block deletes them: a
      // replay of one is not a theft to detect, it is a session of nobody.
      await tx.refreshToken.deleteMany({ where: { userId } });
      // What the account was told and what it waited for are its own and nobody's history.
      await tx.accountMail.deleteMany({ where: { userId } });
      await tx.mailConfirmation.deleteMany({ where: { userId } });
      await tx.mailReplyToken.deleteMany({ where: { userId } });
      await tx.mailOutbox.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.waitlistEntry.deleteMany({ where: { userId } });
      // Retired the way `DELETE /listings/:id` retires one: off the catalogue, closed to new
      // stays, the stays already taken against it keeping their record.
      await tx.listing.updateMany({
        where: { ownerId: userId, ...STILL_OFFERED },
        data: { deletedAt: now },
      });
    });
  }
}

/** One row of the `FOR UPDATE` read — raw SQL, so the columns keep their stored names. */
type LockedAccount = {
  role: Role;
  blocked_at: Date | null;
  deleted_at: Date | null;
  payouts_enabled_at: Date | null;
};

/**
 * An address nobody receives mail at — `.invalid` is reserved for exactly that (RFC 2606) —
 * and unique by the id, which frees the real one for a new registration.
 */
export function placeholderEmail(userId: string): string {
  return `deleted-${userId}@deleted.invalid`;
}

/**
 * What is still open on the account, in `ACCOUNT_OPEN_MATTERS`' order, and on which side of
 * its stays. Each matter is one read per side, run one after another on the transaction's
 * connection; a host's share and a host's fee have only the host's side.
 */
async function openMatters(
  tx: Prisma.TransactionClient,
  userId: string,
  { now, payoutsEnabled }: { now: Date; payoutsEnabled: boolean },
): Promise<{
  open: OpenMatter[];
  asGuest: OpenMatter[];
  asHost: OpenMatter[];
}> {
  const asGuest = { guestId: userId } satisfies Prisma.BookingWhereInput;
  const asHost = againstListingsOf(userId);

  const anyStay = async (where: Prisma.BookingWhereInput): Promise<boolean> =>
    (await tx.booking.count({ where })) > 0;

  const found: Record<OpenMatter, Record<StayParty, boolean>> = {
    ACCOUNT_HAS_OPEN_STAY: {
      [StayParty.GUEST]: await hasOpenStay(tx, asGuest, now),
      [StayParty.HOST]: await hasOpenStay(tx, asHost, now),
    },
    ACCOUNT_HAS_OPEN_DISPUTE: {
      [StayParty.GUEST]: await anyStay({
        ...asGuest,
        disputeStatus: DisputeStatus.OPEN,
      }),
      [StayParty.HOST]: await anyStay({
        ...asHost,
        disputeStatus: DisputeStatus.OPEN,
      }),
    },
    // The guest's money alone. A refund owed on a stay the account hosted goes back to its
    // guest from the platform's balance, by a job that needs nobody to sign in, and the
    // host's side of it — what is left to pay them — is `ACCOUNT_AWAITS_PAYOUT`'s.
    ACCOUNT_AWAITS_REFUND: {
      [StayParty.GUEST]:
        (await anyStay({ ...asGuest, refundOwedCents: { not: null } })) ||
        // Money a bank sent back is still the guest's until somebody sends it some other way.
        (await tx.refundFailure.count({
          where: { resolvedAt: null, booking: asGuest },
        })) > 0,
      [StayParty.HOST]: false,
    },
    ACCOUNT_AWAITS_PAYOUT: {
      [StayParty.GUEST]: false,
      [StayParty.HOST]: await hasUnreachableShare(tx, asHost, payoutsEnabled),
    },
    ACCOUNT_OWES_HOST_FEE: {
      [StayParty.GUEST]: false,
      [StayParty.HOST]:
        (await tx.hostFee.count({ where: owedFeesWhere(tx, userId) })) > 0,
    },
  };

  const openOn = (side: StayParty): OpenMatter[] =>
    ACCOUNT_OPEN_MATTERS.filter((matter) => found[matter][side]);

  return {
    open: ACCOUNT_OPEN_MATTERS.filter(
      (matter) =>
        found[matter][StayParty.GUEST] || found[matter][StayParty.HOST],
    ),
    asGuest: openOn(StayParty.GUEST),
    asHost: openOn(StayParty.HOST),
  };
}

/**
 * A host's share of a stay that no payout could reach once nobody can sign in to set one up:
 * every share still to send while the account's payouts are off, only the ones set aside
 * after failing while they are on. A share the sweep will pay holds nothing back.
 *
 * Read by the contract's own `owedToHost` rather than `payoutOwed`, because a refund still
 * owed to the guest is part of the question rather than a reason to skip the stay:
 * `payoutOwed` leaves such a stay out until the refund is recorded, and the share left after
 * it — a guest's partial refund under the policy — would then fall due on an account nothing
 * can pay. A refund owed in full leaves the host nothing, and the stay holds nothing back.
 * An open dispute is a matter of its own, and a lost one left the host nothing to send.
 */
async function hasUnreachableShare(
  tx: Prisma.TransactionClient,
  side: Prisma.BookingWhereInput,
  payoutsEnabled: boolean,
): Promise<boolean> {
  const stays = await tx.booking.findMany({
    where: {
      // Two conditions of one `AND`, so the side's own condition is never replaced.
      AND: [
        side,
        {
          paidAt: { not: null },
          paidOutAt: null,
          OR: [{ disputeStatus: null }, { disputeStatus: DisputeStatus.WON }],
          ...(payoutsEnabled ? { payoutFailedAt: { not: null } } : {}),
        },
      ],
    },
    select: {
      amountCents: true,
      currency: true,
      refundedAmountCents: true,
      refundOwedCents: true,
      disputeStatus: true,
    },
  });

  return stays.some(
    (stay) =>
      owedToHost({
        ...toStayMoney(stay),
        paid: true,
        dispute: stay.disputeStatus,
      }) > 0,
  );
}

/**
 * A hold — whatever its deadline, since a payment can still confirm a lapsed one no path has
 * released — or a confirmed stay not over yet, on one side of the account's stays: its
 * check-out day not reached where the listing is (`stayDay`). The read narrows the confirmed
 * ones to a check-out from yesterday in UTC on, which holds every zone's today; the zone
 * itself is the contract's to read.
 *
 * A stay ended early is over, whatever its check-out says: the early end moves `to_date` to
 * tomorrow and keeps `CONFIRMED`, yet nothing can happen to the stay any more — no
 * cancellation, no second early end — and `isReviewable` reads it as finished too. The
 * refund of its unused nights is still open until it is sent, and `ACCOUNT_AWAITS_REFUND`
 * says so.
 */
async function hasOpenStay(
  tx: Prisma.TransactionClient,
  side: Prisma.BookingWhereInput,
  now: Date,
): Promise<boolean> {
  const utc = { in: tz("UTC") };
  const stays = await tx.booking.findMany({
    where: {
      status: { in: [...ACTIVE_STATUSES] },
      // Two conditions of one `AND`, so the side's own condition is never replaced.
      AND: [
        side,
        {
          OR: [
            { status: BookingStatus.PENDING_PAYMENT },
            {
              to: { gte: subDays(startOfDay(now, utc), 1, utc) },
              endedEarlyAt: null,
            },
          ],
        },
      ],
    },
    select: { status: true, to: true, timeZone: true },
  });

  return stays.some(
    (stay) =>
      stay.status === BookingStatus.PENDING_PAYMENT ||
      stayDay(stay, now) < toIsoDate(stay.to),
  );
}
