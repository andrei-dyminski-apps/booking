"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { Booking, Canceller } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { CancelStayDialog } from "#features/cancel-booking";
import { bookingKey } from "../api/booking-query";
import { cancelStayAction } from "../api/cancel-stay-action";

/**
 * Cancelling from the stay's own page, in the dialog the list opens too, through a Server
 * Action of this page. A success reads the booking the page polls again, refund and all —
 * the page says `Cancelled` only once the API has.
 */
export const CancelStayButton = ({
  booking,
  canceller,
  refundNote,
}: {
  booking: Booking;
  /** Who the viewer cancels as — `cancellerOf`. */
  canceller: Canceller;
  /** What the cancellation gives back or costs, worded for the viewer. */
  refundNote: string | null;
}) => {
  const queryClient = useQueryClient();

  return (
    <CancelStayDialog
      canceller={canceller}
      status={booking.status}
      refundNote={refundNote}
      action={cancelStayAction.bind(null, booking.id)}
      onCancelled={() => {
        void queryClient.invalidateQueries({
          queryKey: bookingKey(booking.id),
        });
      }}
      trigger={<Button variant="outline" className="w-full sm:w-auto" />}
    />
  );
};
