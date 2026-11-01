import {
  BookingStatus,
  DisputeStatus,
  isCancellableOn,
  Role,
  type Booking,
  type User,
} from "@repo/contracts";
import { isHoldOpen } from "#entities/booking";
import { dayOf } from "#shared/lib";

/**
 * Whether "Cancel" is worth offering, which is not the same as whether it is allowed: the
 * API decides that on every request — the guest and an admin may cancel, the owner of the
 * listing may read the stay and not cancel it — and a button rendered by mistake would
 * reach a `403` rather than a cancelled booking. Two screens offer it, the list of stays
 * and a stay's own page, and both have to offer it to the same people.
 *
 * The stay half is every rule the API refuses by: `isCancellableOn` — a hold, or a
 * confirmed stay whose check-in day has not come —, a hold still before its deadline, and
 * a payment not disputed with the bank. `now` is the server's at the render.
 *
 * What it does not carry is the stay's page hiding the button from a hold whose payment
 * was sent from that tab and waits for its webhook: that is state of the tab, which neither
 * the server nor the list can see. Offering the button then is safe — the API refunds the
 * payment in full when the webhook lands.
 */
export function mayCancel(
  booking: Pick<
    Booking,
    "status" | "from" | "expiresAt" | "dispute" | "guestId"
  >,
  viewer: Pick<User, "id" | "role">,
  now: string,
): boolean {
  const holdLapsed =
    booking.status === BookingStatus.PENDING_PAYMENT &&
    !isHoldOpen(booking, now);

  return (
    isCancellableOn(booking, dayOf(now)) &&
    !holdLapsed &&
    booking.dispute !== DisputeStatus.OPEN &&
    (viewer.role === Role.ADMIN || viewer.id === booking.guestId)
  );
}
