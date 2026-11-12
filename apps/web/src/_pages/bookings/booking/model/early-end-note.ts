import {
  DisputeStatus,
  earlyCheckOut,
  NO_CENTS,
  notRefunded,
  unusedNightsRefund,
  type BookingDetail,
  type Cents,
  type EndStayEarlyInput,
} from "@repo/contracts";
import { sharePercent } from "#entities/booking";
import {
  addDays,
  countOf,
  formatDay,
  formatMomentIn,
  formatMoney,
  nightsBetween,
} from "#shared/lib";

/** What the early-end dialog states and sends: the API's body, and the sentence for it. */
export type EarlyEndTerms = EndStayEarlyInput & { note: string };

type EarlyEndFacts = Pick<
  BookingDetail,
  | "nights"
  | "cancellationPolicy"
  | "amountCents"
  | "refundedAmountCents"
  | "currency"
  | "paid"
  | "dispute"
  | "timeZone"
>;

/**
 * Ending the stay at `now`, as the dialog states it and the API is asked to keep to: the
 * check-out, the refund `earlyEndNote` words and the note itself, from one reading of the
 * stay.
 */
export function earlyEndTerms(
  booking: EarlyEndFacts,
  now: Date,
): EarlyEndTerms {
  return {
    checkOut: earlyCheckOut(booking, now),
    refundCents: earlyEndRefundCents(booking, now),
    note: earlyEndNote(booking, now),
  };
}

/**
 * The refund `earlyEndNote` states, in cents: nothing for a stay nobody paid for or one whose
 * dispute was lost — the cases the API gives nothing back for whatever the nights are worth —
 * else `unusedNightsRefund`, which is nothing for a stay refunded in full already.
 */
export function earlyEndRefundCents(booking: EarlyEndFacts, now: Date): Cents {
  if (!booking.paid || booking.dispute === DisputeStatus.LOST) return NO_CENTS;

  return unusedNightsRefund(booking, booking.nights, now).cents;
}

/**
 * What ending the stay at `now` does, worded before the button: the new check-out, the
 * nights that go back on offer and what they give back. It reads `unusedNightsRefund`, the
 * rule the API refunds by, over the stay's frozen policy and the nights it bought, so the
 * sentence and the refund are one decision. A stay nobody paid for, one whose dispute was
 * lost and one refunded in full already give nothing back, each said so; an open dispute is
 * not offered the button at all, since the API refuses it. A share of nights earlier refunds
 * already gave part of back says so, rather than naming a percentage the amount is not.
 */
export function earlyEndNote(booking: EarlyEndFacts, now: Date): string {
  const refund = unusedNightsRefund(booking, booking.nights, now);
  const leaving = `The stay checks out tomorrow, ${formatDay(refund.checkOut)}, and the ${countOf(refund.nights, "night")} after tonight ${refund.nights === 1 ? "goes" : "go"} back on offer.`;

  if (!booking.paid) return `${leaving} Nothing was paid for the stay.`;

  if (booking.dispute === DisputeStatus.LOST) {
    return `${leaving} The bank has returned the payment after a dispute: nothing more is refunded.`;
  }

  if (notRefunded(booking.amountCents, booking.refundedAmountCents) === 0) {
    return `${leaving} The stay has been refunded in full already.`;
  }

  if (refund.shareBps <= 0) {
    return `${leaving} The stay's cancellation policy refunds nothing for unused nights.`;
  }

  const amount = formatMoney(refund.cents, booking.currency);

  if (refund.reduced) {
    return `${leaving} The stay's cancellation policy refunds ${sharePercent(refund.shareBps)} of what is left of them after the earlier refunds, which gave back part of every night: ${amount} back to the card it was paid with.`;
  }

  return `${leaving} The stay's cancellation policy refunds ${sharePercent(refund.shareBps)} of them: ${amount} back to the card it was paid with.`;
}

/**
 * The line a stay ended early carries, or `null`: when, the check-out it now has against the
 * one it was booked to, and the nights that went back on offer. The header's dates and night
 * count are the stay as it stands and the breakdown is the nights that were bought, so this
 * is what joins the two. The row keeps only the new check-out; the booked one is the day
 * after the last night bought — every stay that can end early has its nights recorded.
 */
export function endedEarlyNote(
  booking: Pick<BookingDetail, "endedEarlyAt" | "to" | "nights" | "timeZone">,
): string | null {
  if (booking.endedEarlyAt === null) return null;

  const ended = `Ended early on ${formatMomentIn(booking.endedEarlyAt, booking.timeZone)}`;
  const last = booking.nights.at(-1);

  if (last === undefined) return `${ended}.`;

  const bookedTo = addDays(last.date, 1);

  return `${ended}: it checks out on ${formatDay(booking.to)} instead of ${formatDay(bookedTo)}, and the ${countOf(nightsBetween(booking.to, bookedTo), "night")} after that went back on offer.`;
}
