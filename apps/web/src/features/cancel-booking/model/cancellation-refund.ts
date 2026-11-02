import { parseISO } from "date-fns";
import {
  BookingStatus,
  CANCELLATION_TERMS,
  DisputeStatus,
  isCancellableOn,
  notRefunded,
  refundQuote,
  Role,
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
import { dayOf, formatMoney } from "#shared/lib";

/**
 * What cancelling a paid stay would give back, said to whoever is looking — or `null` when
 * there is nothing to say: a hold or a stay nobody paid for has nothing to give back, and a
 * host is not offered the button. It reads `refundQuote`, the rule the API refunds by, over
 * the stay's own frozen policy, so the sentence and the refund are the same decision: an
 * admin's cancellation gives back whatever is left whenever it happens, a guest's the share
 * of the window it falls in, less what a refund from Stripe's dashboard gave back already.
 * The sentence names when the share falls next and, once one window has closed, what it
 * would have been before. A dispute the bank has settled against the stay has given the
 * money back already; an open one is not offered the button at all (`mayCancel`), so it
 * needs no sentence.
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
    | "guestId"
    | "createdAt"
    | "cancellationPolicy"
  >,
  viewer: Pick<User, "id" | "role">,
  now: string,
): string | null {
  if (booking.status !== BookingStatus.CONFIRMED || !booking.paid) return null;

  // A stay that has begun can no longer be cancelled, so there is no refund to word.
  if (!isCancellableOn(booking, dayOf(now))) {
    return null;
  }

  const admin = viewer.role === Role.ADMIN;

  if (!admin && viewer.id !== booking.guestId) return null;

  if (booking.dispute === DisputeStatus.LOST) {
    return "The bank has returned the payment after a dispute: cancelling refunds nothing more.";
  }

  const left = notRefunded(booking.amountCents, booking.refundedAmountCents);

  if (left === 0) {
    return "The stay has been refunded in full already: cancelling refunds nothing more.";
  }

  const moment = parseISO(now);

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
  const sentence = `Cancelling before ${windowEnd(quote.next.until)} refunds ${what}; after that, ${after}.`;

  // The window that closed last, if one has: what waiting cost.
  return quote.closed === null
    ? sentence
    : `${sentence} Before ${windowEnd(quote.closed.until)} it would have been ${shareInWords(quote.closed.shareBps)}.`;
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
