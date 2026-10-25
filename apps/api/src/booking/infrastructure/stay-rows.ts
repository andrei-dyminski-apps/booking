import type {
  Prisma,
  Booking as BookingRow,
  Listing as ListingRow,
} from "../../generated/prisma/client";
import { toIsoDate } from "../../prisma/iso-date";
import type { ReleasedHold, RefundTarget } from "../domain/booking.types";

/*
 * A stay's money and its two people off a row. A file of its own because `PayoutRepository`
 * reads the same rows, and a row mapping does not cross between two repositories — the
 * shape `listing-pricing.ts` has.
 */

/**
 * What a released hold is read back with: the listing's title for the notice and its owner
 * for the recipient. `updateManyAndReturn` loads to-one relations only, which is all this
 * needs — the reviews `toBooking` reads are not wanted here.
 */
export const RELEASED_HOLD_INCLUDE = {
  listing: { select: { title: true, ownerId: true } },
} satisfies Prisma.BookingIncludeUpdateManyAndReturn;

/** The one reading of a stay's money, which `PayoutRepository` extends with its own. */
export function toRefundTarget(
  row: BookingRow & { listing: Pick<ListingRow, "title" | "ownerId"> },
): RefundTarget {
  return {
    bookingId: row.id,
    status: row.status,
    amount: row.amount.toNumber(),
    refundedAmount: row.refundedAmount?.toNumber() ?? null,
    refundOwed: row.refundOwed?.toNumber() ?? null,
    paid: row.paidAt !== null,
    confirmationAnnounced: row.confirmationAnnouncedAt !== null,
    hold: toReleasedHold(row),
  };
}

export function toReleasedHold(
  row: BookingRow & { listing: Pick<ListingRow, "title" | "ownerId"> },
): ReleasedHold {
  return {
    stay: {
      bookingId: row.id,
      listingId: row.listingId,
      listingTitle: row.listing.title,
      from: toIsoDate(row.from),
      to: toIsoDate(row.to),
    },
    guestId: row.guestId,
    listingOwnerId: row.listing.ownerId,
    paymentId: row.paymentIntentId,
  };
}
