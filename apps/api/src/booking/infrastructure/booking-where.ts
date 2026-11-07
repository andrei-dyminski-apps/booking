import {
  BookingStatus,
  DisputeStatus,
  HOST_CANCELLATIONS_WINDOW_DAYS,
} from "@repo/contracts";
import { tz } from "@date-fns/tz";
import { subDays } from "date-fns";
import type { Prisma } from "../../generated/prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";
import { ACTIVE_STATUSES } from "../domain/booking-status";

// The `where` clauses that cross between repositories: the booking repositories, the
// payouts, the catalogue, the waitlist and the lookups read the stays and the host's fees
// through these.
// A `where` may cross, a row mapping may not — that stays in the repositories and
// `stay-rows.ts`.

/**
 * The stays taken against this owner's listings — the owner's scope, written once because
 * three reads narrow by it: the owner's page of stays and `hasStayedWith`
 * (`BookingRepository`), and the lookups that suggest what that page can be filtered by
 * (`LookupRepository`), which must not offer an owner a guest or a listing their own list
 * would never show.
 */
export function againstListingsOf(ownerId: string): Prisma.BookingWhereInput {
  return { listing: { ownerId } };
}

/**
 * A hold whose deadline has passed, written once because three writes ask for it: the
 * lazy sweep inside `create`, the job that releases one hold and the repeatable sweep
 * behind it. The boundary is inclusive: a hold is done holding the moment its deadline is
 * reached, not a millisecond after.
 */
export function lapsedHolds(now: Date): Prisma.BookingWhereInput {
  return { status: BookingStatus.PENDING_PAYMENT, expiresAt: { lte: now } };
}

/**
 * A stay that is holding its slot at this moment: active, and not a hold that has already
 * lapsed. Written as the complement of `lapsedHolds` rather than as a second list of
 * conditions, so the two cannot drift.
 *
 * Both of them read `expires_at`, and a `PENDING_PAYMENT` row with none would make both
 * NULL rather than true or false — a hold this file cannot see and the `EXCLUDE`
 * constraint still counts. That row cannot exist: `bookings_hold_has_deadline` refuses it
 * at the database, which is what lets the complement be written this simply.
 *
 * The reads that ask it are five, and two of them are in other modules: `create` refuses
 * an overlap with it, `findActiveRanges` reports the ranges it matches, `hasStayedWith`
 * opens a guest's reviews to a host only by it, `ListingRepository` filters the catalogue
 * by the listings that match none of them, and `WaitlistRepository` tells a waiter only
 * when no stay it matches holds a night of their range.
 */
export function holdsTheSlot(now: Date): Prisma.BookingWhereInput {
  return { status: { in: [...ACTIVE_STATUSES] }, NOT: lapsedHolds(now) };
}

/**
 * Two nights that share one: check-out is exclusive, so a stay starting the day another
 * ends is not an overlap. The strict inequalities are the same rule the `EXCLUDE`
 * constraint spells as `daterange(from, to, '[)') WITH &&`.
 */
export function overlapping(
  from: string,
  to: string,
): Prisma.BookingWhereInput {
  return { from: { lt: new Date(to) }, to: { gt: new Date(from) } };
}

/** Where the window of a host's cancellations starts, for the window that ends at `now`. */
export function cancellationsWindowStart(now: Date): Date {
  return subDays(now, HOST_CANCELLATIONS_WINDOW_DAYS, { in: tz("UTC") });
}

/**
 * The cancellations of a host that count within the window ending at `now`: the fees written
 * for them, one per paid stay, less the ones an admin waived — the waiver says the
 * cancellation was not the host's doing. Written once, so the admins' threshold notice
 * (`BookingCancellationRepository.hostCancellations`) and the host's overview
 * (`HostFeeRepository.overviewOf`) count the same stays.
 */
export function countedCancellationsWhere(
  hostId: string,
  now: Date,
): Prisma.HostFeeWhereInput {
  return {
    hostId,
    createdAt: { gte: cancellationsWindowStart(now) },
    waivedAt: null,
  };
}

/**
 * A fee neither waived nor withheld in full — what a host still owes. Written once, so a
 * payout's reservation, the admin's waiver, the host's overview and the list of stuck payouts
 * agree on what is owed.
 */
export function owedFeesWhere(
  client: Pick<Prisma.TransactionClient, "hostFee">,
  hostId: string | { in: string[] },
): Prisma.HostFeeWhereInput {
  return {
    hostId,
    waivedAt: null,
    withheldCents: { lt: client.hostFee.fields.amountCents },
  };
}

/**
 * A paid stay whose host may still be sent a transfer — the coarse cut `findDuePayouts` and
 * `stuckPayout` both read, written once so the sweep and the admin's list cannot drift. A
 * stay refunded in full or a dispute lost left the host nothing to send, and nothing leaves
 * while a dispute is open; the exact amount is the service's rule. A refund still on its way
 * is sent first, and the stay comes back once it is recorded.
 */
export function payoutOwed(
  fields: Prisma.BookingFieldRefs,
): Prisma.BookingWhereInput {
  return {
    paidAt: { not: null },
    // Not `transferId`: a payout the host's fees took whole sends no transfer.
    paidOutAt: null,
    refundOwedCents: null,
    AND: [
      { OR: [{ disputeStatus: null }, { disputeStatus: DisputeStatus.WON }] },
      {
        OR: [
          { refundedAmountCents: null },
          { refundedAmountCents: { lt: fields.amountCents } },
        ],
      },
    ],
  };
}

/**
 * Whether the stay is there at all — what tells a refused retry's `409` from its `404`, in
 * both modules that retry something set aside on a stay.
 */
export async function bookingExists(
  prismaService: PrismaService,
  id: string,
): Promise<boolean> {
  return (await prismaService.booking.count({ where: { id } })) > 0;
}

/**
 * A payout set aside that is still owed — what `GET /bookings/stuck?kind=payout` lists and
 * what `PayoutRepository.handBackPayout` hands back, written once so a retry is refused for
 * exactly the stays the list leaves out: one a retry would only find owing nothing again,
 * held by an open dispute or waiting on a refund still owed. A dispute won, or the refund
 * recorded, brings the row back to the list.
 */
export function stuckPayout(
  fields: Prisma.BookingFieldRefs,
): Prisma.BookingWhereInput {
  return { AND: [payoutOwed(fields), { payoutFailedAt: { not: null } }] };
}
