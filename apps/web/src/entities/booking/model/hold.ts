import { isBefore, parseISO } from "date-fns";
import { BookingStatus, type Booking, type User } from "@repo/contracts";

/**
 * Whether a hold still keeps its nights at `now`. Past its deadline it only waits for the
 * sweep — up to a minute — and the API already refuses to pay for it or cancel it, so no
 * screen offers either. `now` is the server's at the render, handed down like `today()`.
 */
export function isHoldOpen(
  booking: Pick<Booking, "status" | "expiresAt">,
  now: string,
): boolean {
  return (
    booking.status === BookingStatus.PENDING_PAYMENT &&
    booking.expiresAt !== null &&
    isBefore(parseISO(now), parseISO(booking.expiresAt))
  );
}

/**
 * Whether the viewer is the one a hold waits on: its guest, before the deadline. The list
 * words its link "Pay" by it and the stay's page hands the payment form its key by it —
 * the API decides it again when the form asks for the payment.
 */
export function awaitsPaymentFrom(
  booking: Pick<Booking, "status" | "expiresAt" | "guestId">,
  viewer: Pick<User, "id">,
  now: string,
): boolean {
  return booking.guestId === viewer.id && isHoldOpen(booking, now);
}
