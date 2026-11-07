"use client";

import type { BookingStatus, Canceller } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { CancelStayDialog } from "#features/cancel-booking";
import { cancelBookingAction } from "../api/cancel-booking-action";

/**
 * Cancelling from the list. Cancelling is terminal — the API moves the row to `CANCELLED`
 * and refuses a second attempt — so it asks first, in the dialog both screens share
 * (`CancelStayDialog`); what is this list's is the request, bound to the stay and its
 * listing.
 *
 * A success does not redirect: the row stays where it is and says `Cancelled` once
 * `refresh()` has re-rendered the list behind the closing dialog.
 */
export const CancelBookingButton = ({
  bookingId,
  listingId,
  status,
  canceller,
  refundNote,
}: {
  bookingId: string;
  listingId: string;
  status: BookingStatus;
  /** Who the viewer cancels as — `cancellerOf`. */
  canceller: Canceller;
  /** What the cancellation gives back or costs, worded for the viewer. */
  refundNote: string | null;
}) => (
  <CancelStayDialog
    canceller={canceller}
    status={status}
    refundNote={refundNote}
    action={cancelBookingAction.bind(null, bookingId, listingId)}
    trigger={<Button variant="outline" size="sm" />}
    short
  />
);
