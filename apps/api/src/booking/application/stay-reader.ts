import { NotFoundException, type HttpException } from "@nestjs/common";
import { ActorKind, cancellerOf } from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { apiException } from "../../common/api-exception";
import type { BookingWithListingOwner } from "../domain/booking.types";

/** The id stays in the sentence for the log; a client reads the code. */
export function bookingNotFound(id: string): HttpException {
  return apiException(
    NotFoundException,
    "BOOKING_NOT_FOUND",
    `Booking ${id} not found`,
  );
}

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
): { found: Found; reader: ActorKind } {
  const reader =
    found === null
      ? null
      : cancellerOf(
          { guestId: found.booking.guestId, hostId: found.listingOwnerId },
          user,
        );

  if (found === null || reader === null) {
    throw bookingNotFound(id);
  }

  return { found, reader };
}
