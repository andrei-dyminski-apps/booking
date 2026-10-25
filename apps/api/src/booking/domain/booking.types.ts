import type { Booking, BookingStatus, StayNotice } from "@repo/contracts";

/**
 * The owner of the listing is kept beside the booking rather than inside it: the
 * authorization rules need that column, the contract does not have it, and a flat shape
 * would let a `return booking` carry it into a response body without the types or the
 * review noticing. The payment is the same case — the id of a PaymentIntent is what
 * cancelling and refunding are done through, and nothing a reader of the booking needs.
 */
export type BookingWithListingOwner = {
  booking: Booking;
  listingOwnerId: string;
  paymentId: string | null;
};

/**
 * A hold one of the three expiry paths let go of, with the two people it concerned. Not a
 * `Booking`: the row is read back by the `UPDATE` that released it, and what is said about
 * it afterwards is a notice — so it carries what a notice copies and nothing a response
 * body would want.
 */
export type ReleasedHold = {
  stay: StayNotice;
  guestId: string;
  listingOwnerId: string;
  /** Withdrawn now that it can never complete. */
  paymentId: string | null;
};

/** The same shape as a released hold, because the same two people are told. */
export type ConfirmedStay = ReleasedHold;

/** The payment the row named when it was cancelled. */
export type CancelledStay = {
  paymentId: string | null;
};

/** A stay's money as the payment handlers read it; `SettledStay` extends it. */
export type RefundTarget = {
  bookingId: string;
  status: BookingStatus;
  amount: number;
  refundedAmount: number | null;
  refundOwed: number | null;
  /** Whatever its status now. */
  paid: boolean;
  confirmationAnnounced: boolean;
  hold: ReleasedHold;
};

/**
 * What `create` hands back: the new hold, and the lapsed holds of the same listing its
 * transaction released on the way — those are only released if the hold is taken, because
 * a refusal rolls the release back with it.
 */
export type CreatedBooking = BookingWithListingOwner & {
  released: ReleasedHold[];
};

/**
 * The place in a list of stays a page ends, as the client hands it back. Keyset rather
 * than an offset, for the reason `catalogue-cursor.ts` spells out: a booking taken while
 * somebody is paging would shift every offset after it, showing one row twice and skipping
 * another. Here the shift is the ordinary case rather than the rare one — `newest` is the
 * default and a new stay lands at the top of it.
 *
 * The pair it carries is the pair the ordering is made of — the sort key and `id`, the
 * tiebreaker for two rows level on that key — and the sort itself, which is what makes the
 * key readable: `2026-09-01` is a check-in under one ordering and nothing at all under
 * another. It is also what lets the API refuse a cursor handed back under a different
 * ordering; see `readCursor` in `src/common/paging.ts`.
 */
export type BookingCursor =
  | { sort: "newest" | "oldest"; createdAt: Date; id: string }
  | { sort: "checkInAsc" | "checkInDesc"; from: Date; id: string };
