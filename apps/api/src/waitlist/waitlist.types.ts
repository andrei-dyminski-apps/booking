import type { StayNotice } from "@repo/contracts";

/**
 * Nights that stopped being held — by a cancellation or a lapsed hold. Both a `Booking`
 * and the `StayNotice` of a released hold have these three fields, so either is handed
 * over as it is.
 */
export type FreedNights = Pick<StayNotice, "listingId" | "from" | "to">;

/**
 * An entry whose whole range is free now, with what its notice copies. Both layers need
 * the two types, so they live here and the repository never imports from the service —
 * the direction `auth.types.ts` keeps.
 */
export type WaitingEntry = {
  id: string;
  userId: string;
  nights: Omit<StayNotice, "bookingId">;
};
