import { owedToHost, StuckKind, type Booking } from "@repo/contracts";
import {
  addCents,
  minCents,
  NO_CENTS,
  subtractCents,
  type Cents,
} from "../../payment/domain/money";
import type { StuckPayout } from "./booking.types";

/** What a stuck payout's share is read from — `owedToHost`'s facts. */
type ShareFacts = Pick<
  Booking,
  | "amountCents"
  | "refundedAmountCents"
  | "refundOwedCents"
  | "paid"
  | "dispute"
  | "currency"
>;

/**
 * Whose debt a payout keeps back from: the host's fees in the stay's currency, since a payout
 * keeps back cents of what it sends — the key `shareOutHostFees` reads its `feesOwed` by.
 */
export function hostFeesKey(hostId: string, currency: string): string {
  return `${hostId}:${currency}`;
}

/**
 * What the job would send for a stay set aside.
 *
 * - `refund`: the refund a cancellation or an early end owes the guest.
 * - `payout`: a reservation still standing (`standingReservation`), as it is. Without one, the
 *   host's share by `owedToHost` less the fees left for this stay (`shareOutHostFees`) — the
 *   split `PayoutService` reserves by, so a lost dispute, a refund and the fees count here as
 *   they do there. A reservation the stay has outgrown is released before the next one is
 *   made, so what it kept back is owed again and counts among those fees.
 *
 * Known to read low in one case: a waiver of a fee after a reservation that then went stale.
 * The part kept back for that fee goes back onto it and is forgiven with it instead of being
 * owed again. It is rare enough to leave unhandled.
 */
export function owedOnStuck(
  kind: StuckKind,
  booking: Booking,
  payout: StuckPayout | null,
): Cents {
  if (kind === StuckKind.refund) return booking.refundOwedCents ?? NO_CENTS;

  const owed = owedToHost(booking);

  if (payout === null) return owed;

  return (
    standingReservation(owed, payout) ??
    subtractCents(
      owed,
      minCents(owed, feesFor(payout.hostFeesOwedCents, payout)),
    )
  );
}

/**
 * The fees each host owes in each currency (`hostFeesKey`), shared out over their stuck
 * payouts in that currency in the order given — the
 * oldest set aside first — the way payouts retried in that order would keep them back: each
 * stay is answered what the ones before it left. So the figures of one host's stays add up to
 * what retrying them all would send, rather than each taking the whole debt off. A standing
 * reservation takes nothing, because what it keeps back is on the fees already; one the stay
 * outgrew gives what it kept back to the debt first, as its release does.
 */
export function shareOutHostFees(
  stays: readonly {
    booking: ShareFacts & Pick<Booking, "id" | "hostId">;
    payout: Pick<StuckPayout, "reservedCents" | "feeWithheldCents">;
  }[],
  feesOwed: ReadonlyMap<string, Cents>,
): Map<string, Cents> {
  const left = new Map(feesOwed);
  const shared = new Map<string, Cents>();

  for (const { booking, payout } of stays) {
    const key = hostFeesKey(booking.hostId, booking.currency);
    const fees = left.get(key) ?? NO_CENTS;
    const owed = owedToHost(booking);

    shared.set(booking.id, fees);

    if (standingReservation(owed, payout) === null) {
      const debt = feesFor(fees, payout);

      left.set(key, subtractCents(debt, minCents(owed, debt)));
    }
  }

  return shared;
}

/**
 * The debt a stay's next reservation keeps back from: the fees left for it, and what an
 * outgrown reservation of its own kept back, which its release hands back first. Nothing for a
 * stay with no reservation — a payout keeps back only with one, or once it is recorded.
 */
function feesFor(
  feesLeft: Cents,
  payout: Pick<StuckPayout, "feeWithheldCents">,
): Cents {
  return addCents(feesLeft, payout.feeWithheldCents);
}

/**
 * The reserved payout, if a retry can still send it as it is: the reservation plus what it
 * kept back for fees must not exceed what the host is owed now. `null` when nothing is
 * reserved, or when a refund or a dispute has outgrown the reservation — it will be released
 * and made afresh, so the caller has to recompute the amount.
 */
function standingReservation(
  owed: Cents,
  payout: Pick<StuckPayout, "reservedCents" | "feeWithheldCents">,
): Cents | null {
  return payout.reservedCents !== null &&
    addCents(payout.reservedCents, payout.feeWithheldCents) <= owed
    ? payout.reservedCents
    : null;
}
