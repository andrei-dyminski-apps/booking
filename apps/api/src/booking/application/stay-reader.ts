import { NotFoundException } from "@nestjs/common";
import { Canceller, cancellerOf } from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import type { BookingWithListingOwner } from "../domain/booking.types";

/**
 * `getReadable`'s rule over a row already read, whatever else was read beside it, answering
 * which of the stay's three readers the caller is — the roles a cancellation is made in, by
 * `cancellerOf`: the guest and the host by the row whatever their role, an admin on somebody
 * else's stay — and the `404` for anybody else.
 */
export function readerOf<Found extends BookingWithListingOwner>(
  user: AuthenticatedUser,
  id: string,
  found: Found | null,
): { found: Found; reader: Canceller } {
  const reader =
    found === null
      ? null
      : cancellerOf(
          { guestId: found.booking.guestId, hostId: found.listingOwnerId },
          user,
        );

  if (found === null || reader === null) {
    throw new NotFoundException(`Booking ${id} not found`);
  }

  return { found, reader };
}
