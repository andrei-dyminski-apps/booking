"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Booking } from "@repo/contracts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTrigger,
} from "@repo/ui/components/alert-dialog";
import { Button } from "@repo/ui/components/button";
import { FieldError } from "@repo/ui/components/field";
import { CancelStayWarning } from "#features/cancel-booking";
import { bookingKey } from "../api/booking-query";
import { cancelStayAction } from "../api/cancel-stay-action";

/**
 * Cancelling from the stay's own page: a Server Action, run as a mutation because the
 * booking lives in the query cache the page polls. It behaves as the list's dialog does: it
 * stays open while the request is on its way and with the reason in it when the API
 * refuses — a cancellation decides a refund, so the page says `Cancelled` only once the API
 * has said so. A success closes it and reads the booking again, refund and all.
 */
export const CancelStayButton = ({
  booking,
  refundNote,
}: {
  booking: Booking;
  /** What the cancellation gives back, worded for the viewer — `cancellationRefundNote`. */
  refundNote: string | null;
}) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const cancel = useMutation({
    mutationFn: () => cancelStayAction(booking.id),
    onSuccess: async ({ message }) => {
      // The API's refusal comes back as an answer rather than a throw: what an action
      // throws reaches the browser with its message hidden in production.
      if (message !== null) return;

      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: bookingKey(booking.id) });
    },
  });
  // A refusal worded by the API, or an action that never answered at all.
  const refusal = cancel.isError
    ? "The stay could not be cancelled."
    : (cancel.data?.message ?? null);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (cancel.isPending) return;

        setOpen(next);
        if (!next) cancel.reset();
      }}
    >
      <AlertDialogTrigger
        render={<Button variant="outline" className="w-full sm:w-auto" />}
      >
        Cancel the stay
      </AlertDialogTrigger>

      <AlertDialogContent>
        <CancelStayWarning refundNote={refundNote} />

        {refusal !== null && <FieldError>{refusal}</FieldError>}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancel.isPending}>
            Keep it
          </AlertDialogCancel>
          <Button
            variant="destructive"
            loading={cancel.isPending}
            onClick={() => {
              cancel.mutate();
            }}
          >
            Cancel the stay
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
