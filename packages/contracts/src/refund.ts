import { tz } from "@date-fns/tz";
import { isBefore, parseISO, subHours } from "date-fns";
import { BookingStatus, type Booking } from "./booking.js";

/**
 * What a paid stay gives back when it is cancelled. A rule rather than a schema, and it
 * lives here for the reason `nightlyPrice` does: the API refunds by it and the booking page
 * states it before anybody presses the button, so a copy on each side of the wire would be
 * a guest promised one refund and given another the day the two drift.
 */

/** How long before check-in a guest may still cancel for everything back. */
export const FREE_CANCELLATION_HOURS = 48;

/** Who let the stay go — the two people `DELETE /bookings/:id` answers. */
export type Canceller = "GUEST" | "ADMIN";

const IN_UTC = { in: tz("UTC") };

/**
 * The last moment a guest cancels for a full refund. A check-in is a calendar day, and the
 * contract reads a day as midnight UTC, so the window closes `FREE_CANCELLATION_HOURS`
 * before that midnight — the same instant in every runtime that asks.
 */
export function freeCancellationUntil(from: string): Date {
  // A plain `Date` out, not the zoned one the arithmetic runs in: the instant is what the
  // callers compare and print, and a `TZDate` spells even its ISO string its own way.
  return new Date(
    subHours(parseISO(from, IN_UTC), FREE_CANCELLATION_HOURS, IN_UTC).getTime(),
  );
}

/**
 * Whether a stay can still be cancelled — by its guest or by an admin, one rule for both: a
 * hold at any time, a confirmed stay only before its check-in day (UTC). From check-in on
 * the nights are being spent, and a cancellation would refund nights already used and,
 * after check-out, take the stay out of review.
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
 * What a cancellation refunds of a paid stay: everything inside the free window and
 * nothing after it, when the guest cancels. An admin's cancellation refunds in full — it
 * is the site taking the stay away rather than the guest changing their mind, and the guest
 * is not the one who should pay for it. Neither may cancel once the stay has begun
 * (`isCancellableOn`).
 *
 * A hold that was never paid refunds nothing; that is the caller's to know, since only the
 * caller knows whether a payment exists.
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
