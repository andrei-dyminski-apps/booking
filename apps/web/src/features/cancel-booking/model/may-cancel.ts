import { parseISO } from "date-fns";
import {
  BookingStatus,
  cancellerOf,
  DisputeStatus,
  isCancellableOn,
  type Booking,
  type User,
} from "@repo/contracts";
import { isHoldOpen } from "#entities/booking";

/**
 * Whether "Cancel" is worth offering, which is not the same as whether it is allowed: the
 * API decides that on every request — the guest, the host of the listing (with a reason, at
 * a fee for a paid stay) and an admin may cancel, anybody else may not even read the stay —
 * and a button rendered by mistake would reach a refusal rather than a cancelled booking.
 * Two screens offer it, the list of stays and a stay's own page, and both have to offer it
 * to the same people.
 *
 * The stay half is every rule the API refuses by: `isCancellableOn` — a hold, or a
 * confirmed stay not ended early whose moment of check-in, on the listing's clock, has not
 * come —, a hold still before its deadline, and a payment not disputed with the bank. `now`
 * is the server's at the render.
 *
 * What it does not carry is the stay's page hiding the button from a hold whose payment
 * was sent from that tab and waits for its webhook: that is state of the tab, which neither
 * the server nor the list can see. Offering the button then is safe — the API refunds the
 * payment in full when the webhook lands.
 */
export function mayCancel(
  booking: Pick<
    Booking,
    | "status"
    | "from"
    | "timeZone"
    | "checkInTime"
    | "endedEarlyAt"
    | "expiresAt"
    | "dispute"
    | "guestId"
    | "hostId"
  >,
  viewer: Pick<User, "id" | "role">,
  now: string,
): boolean {
  const holdLapsed =
    booking.status === BookingStatus.PENDING_PAYMENT &&
    !isHoldOpen(booking, now);

  return (
    isCancellableOn(booking, parseISO(now)) &&
    !holdLapsed &&
    booking.dispute !== DisputeStatus.OPEN &&
    cancellerOf(booking, viewer) !== null
  );
}
