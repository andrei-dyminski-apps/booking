import { parseISO } from "date-fns";
import {
  BookingStatus,
  CANCELLATION_TERMS,
  Canceller,
  cancellerOf,
  DisputeStatus,
  hostCancellationFee,
  isCancellableOn,
  notRefunded,
  refundQuote,
  shareOf,
  type Booking,
  type Cents,
  type User,
} from "@repo/contracts";
import {
  isFullShare,
  shareInWords,
  sharePercent,
  windowEnd,
} from "#entities/booking";
import { formatMoney } from "#shared/lib";

/**
 * What cancelling a paid stay would give back, said to whoever is looking — or `null` when
 * there is nothing to say: a hold or a stay nobody paid for has nothing to give back. The
 * host is told what it costs them instead (`hostCancellationNote`), which they read first.
 * It reads `refundQuote`, the rule the API refunds by, over the stay's own frozen policy,
 * so the sentence and the refund are the same decision: an admin's cancellation gives back
 * whatever is left whenever it happens, a guest's the share of the window it falls in, less
 * what a refund from Stripe's dashboard gave back already. The sentence names when the
 * share falls next and, once one window has closed, what it would have been before. A
 * dispute the bank has settled against the stay has given the money back already; an open
 * one is not offered the button at all (`mayCancel`), so it needs no sentence.
 *
 * `now` is the server's, handed down like `today()`: the render that straddles the end of
 * a window is the one where the server and the browser would otherwise disagree.
 */
export function cancellationRefundNote(
  booking: Pick<
    Booking,
    | "status"
    | "amountCents"
    | "currency"
    | "refundedAmountCents"
    | "paid"
    | "dispute"
    | "from"
    | "timeZone"
    | "checkInTime"
    | "endedEarlyAt"
    | "guestId"
    | "hostId"
    | "createdAt"
    | "cancellationPolicy"
  >,
  viewer: Pick<User, "id" | "role">,
  now: string,
): string | null {
  const canceller = cancellerOf(booking, viewer);

  if (canceller === Canceller.HOST) return hostCancellationNote(booking, now);

  if (booking.status !== BookingStatus.CONFIRMED || !booking.paid) return null;

  const moment = parseISO(now);

  // A stay that has begun can no longer be cancelled, so there is no refund to word.
  if (!isCancellableOn(booking, moment)) {
    return null;
  }

  if (canceller === null) return null;

  const admin = canceller === Canceller.ADMIN;

  if (booking.dispute === DisputeStatus.LOST) {
    return "The bank has returned the payment after a dispute: cancelling refunds nothing more.";
  }

  const left = notRefunded(booking.amountCents, booking.refundedAmountCents);

  if (left === 0) {
    return "The stay has been refunded in full already: cancelling refunds nothing more.";
  }

  if (admin) {
    return `Cancelled by an admin, it refunds ${whatComesBack(booking, left)}.`;
  }

  const quote = refundQuote(booking, moment, "GUEST");

  if (quote.next === null) {
    // The policy rather than the schedule: a stay booked after its windows closed has an
    // empty schedule too, and it is not non-refundable — nor did a window of its own ever
    // close, so it is not told one has.
    if (CANCELLATION_TERMS[booking.cancellationPolicy].tiers.length === 0) {
      return "This stay is non-refundable: cancelling refunds nothing.";
    }

    return quote.closed === null
      ? "This stay was booked too close to check-in for a refund: cancelling refunds nothing."
      : "Every refund window has closed: cancelling now refunds nothing.";
  }

  if (quote.cents === 0) {
    return `What was refunded already covers the ${shareInWords(quote.shareBps)} a cancellation gives back now: cancelling refunds nothing more.`;
  }

  const what = isFullShare(quote.shareBps)
    ? whatComesBack(booking, quote.cents)
    : partOf(booking, quote.shareBps, quote.cents);
  const after =
    quote.next.shareBps > 0
      ? `${shareInWords(quote.next.shareBps)} comes back`
      : "nothing comes back";
  const sentence = `Cancelling before ${windowEnd(quote.next.until, booking.timeZone)} refunds ${what}; after that, ${after}.`;

  // The window that closed last, if one has: what waiting cost.
  return quote.closed === null
    ? sentence
    : `${sentence} Before ${windowEnd(quote.closed.until, booking.timeZone)} it would have been ${shareInWords(quote.closed.shareBps)}.`;
}

/**
 * The host's side of a cancellation: the guest is refunded in full whatever the policy, and
 * the host pays the fee of the window it falls in — `hostCancellationFee`, the rule the API
 * charges by — kept back from their next payouts. Declining a hold costs nothing.
 */
function hostCancellationNote(
  booking: Pick<
    Booking,
    | "status"
    | "paid"
    | "dispute"
    | "amountCents"
    | "refundedAmountCents"
    | "currency"
    | "from"
    | "timeZone"
    | "checkInTime"
    | "endedEarlyAt"
  >,
  now: string,
): string | null {
  if (booking.status === BookingStatus.PENDING_PAYMENT) {
    return "Nobody has paid for this request yet, so declining it costs you nothing.";
  }

  // A stay nobody paid for (the seed's) has nothing to say, as it has nothing for the guest.
  const moment = parseISO(now);

  if (!booking.paid || !isCancellableOn(booking, moment)) return null;

  const fee = hostCancellationFee(booking, moment);

  // Paid, and still no fee: the money has gone back already, one way or the other.
  if (fee.cents === 0) {
    return booking.dispute === DisputeStatus.LOST
      ? "The bank has returned the payment after a dispute: cancelling refunds nothing and costs you nothing."
      : "The stay has been refunded in full already: cancelling refunds nothing more and costs you nothing.";
  }

  return `If you cancel now, the guest is refunded in full and you pay a fee of ${formatMoney(fee.cents, booking.currency)} (${sharePercent(fee.feeBps)} of what it refunds), kept back from your next payouts.`;
}

function whatComesBack(
  booking: Pick<Booking, "refundedAmountCents" | "currency">,
  amount: Cents,
): string {
  return booking.refundedAmountCents === null
    ? "the stay in full"
    : `the remaining ${formatMoney(amount, booking.currency)}`;
}

/**
 * A partial share in money. Once a refund has gone back already the amount is the share
 * less that refund, so the sentence says both: "50% ($50.00)" beside $20.00 would promise
 * a share the amount does not add up to.
 */
function partOf(
  booking: Pick<Booking, "amountCents" | "refundedAmountCents" | "currency">,
  shareBps: number,
  amount: Cents,
): string {
  const money = formatMoney(amount, booking.currency);

  if (booking.refundedAmountCents === null) {
    return `${sharePercent(shareBps)} (${money})`;
  }

  return `${money} (${sharePercent(shareBps)} of the stay, ${formatMoney(shareOf(booking.amountCents, shareBps), booking.currency)}, less the ${formatMoney(booking.refundedAmountCents, booking.currency)} refunded already)`;
}
