import { owedToHost, StuckKind, type Booking } from "@repo/contracts";
import { NO_CENTS, type Cents } from "../../payment/domain/money";

/**
 * What the job would send for a stay set aside: the refund the cancellation owes the guest,
 * or the host's share by `owedToHost` — the rule the payout itself is computed by, so a lost
 * dispute and a refund counted here as they do there.
 */
export function owedOnStuck(kind: StuckKind, booking: Booking): Cents {
  return kind === StuckKind.refund
    ? (booking.refundOwedCents ?? NO_CENTS)
    : owedToHost(booking);
}
