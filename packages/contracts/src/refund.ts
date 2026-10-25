import { tz } from "@date-fns/tz";
import { isBefore, parseISO, subHours } from "date-fns";
import { BookingStatus, type Booking } from "./booking.js";

/**
 * Here for the reason `nightlyPrice` is: the API refunds by it and the booking page states
 * it before the button, so a copy on each side would promise one refund and give another.
 */

export const FREE_CANCELLATION_HOURS = 48;

export type Canceller = "GUEST" | "ADMIN";

const IN_UTC = { in: tz("UTC") };

/** Before midnight UTC of the check-in day, so every runtime agrees on the instant. */
export function freeCancellationUntil(from: string): Date {
  // A plain `Date`: a `TZDate` spells even its ISO string its own way.
  return new Date(
    subHours(parseISO(from, IN_UTC), FREE_CANCELLATION_HOURS, IN_UTC).getTime(),
  );
}

/**
 * One rule for the guest and an admin: from check-in on the nights are being spent, and a
 * cancellation would refund nights already used.
 */
export function isCancellableOn(
  booking: Pick<Booking, "status" | "from">,
  today: string,
): boolean {
  return (
    booking.status === BookingStatus.PENDING_PAYMENT ||
    (booking.status === BookingStatus.CONFIRMED && today < booking.from)
  );
}

/**
 * An admin's cancellation refunds in full: it is the site taking the stay away, not the
 * guest changing their mind. Whether a payment exists at all is the caller's to know.
 */
export function refundOnCancel(
  booking: Pick<Booking, "amount" | "from">,
  now: Date,
  canceller: Canceller,
): number {
  if (canceller === "ADMIN") return booking.amount;

  return isBefore(now, freeCancellationUntil(booking.from))
    ? booking.amount
    : 0;
}
