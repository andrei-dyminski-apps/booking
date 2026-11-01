import { parseISO } from "date-fns";
import {
  BookingStatus,
  DisputeStatus,
  freeCancellationUntil,
  isCancellableOn,
  notRefunded,
  refundOnCancel,
  Role,
  type Booking,
  type User,
} from "@repo/contracts";
import { dayOf, formatMoment, formatMoney } from "#shared/lib";

/**
 * What cancelling a paid stay would give back, said to whoever is looking — or `null` when
 * there is nothing to say: a hold or a stay nobody paid for has nothing to give back, and a
 * host is not offered the button. It reads `refundOnCancel`, the rule the API refunds by,
 * and caps it the way the API does — by what a refund from Stripe's dashboard left of the
 * payment — so the sentence and the refund are the same decision: an admin's cancellation
 * gives back whatever is left whenever it happens, and a guest's only before the free
 * window closes — which, once it has, is no longer a date worth naming. A dispute the bank
 * has settled against the stay has given the money back already; an open one is not
 * offered the button at all (`mayCancel`), so it needs no sentence.
 *
 * `now` is the server's, handed down like `today()`: the render that straddles the end of
 * the window is the one where the server and the browser would otherwise disagree.
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

  const whatComesBack =
    booking.refundedAmountCents === null
      ? "the stay in full"
      : `the remaining ${formatMoney(left, booking.currency)}`;

  if (admin) {
    return refundOnCancel(booking, parseISO(now), "ADMIN") > 0
      ? `Cancelled by an admin, it refunds ${whatComesBack}.`
      : null;
  }

  return refundOnCancel(booking, parseISO(now), "GUEST") > 0
    ? `Cancelling before ${formatMoment(freeCancellationUntil(booking.from).toISOString())} UTC refunds ${whatComesBack}; after that, nothing comes back.`
    : "The free cancellation window has closed: cancelling now refunds nothing.";
}
