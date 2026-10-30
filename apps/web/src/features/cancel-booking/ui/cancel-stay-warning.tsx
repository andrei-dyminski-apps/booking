import { TriangleAlertIcon } from "lucide-react";
import {
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog";

/**
 * What every dialog that cancels a stay says before it does: what comes back, and that
 * the nights do not. One copy for the list of stays and the stay's own page, which differ
 * only in how they send the request — the warning about an irreversible step and the
 * refund policy have to read the same on both.
 */
export const CancelStayWarning = ({
  refundNote,
}: {
  /** What the cancellation gives back, worded for the viewer — `cancellationRefundNote`. */
  refundNote: string | null;
}) => (
  <AlertDialogHeader>
    <AlertDialogMedia>
      <TriangleAlertIcon className="text-destructive" />
    </AlertDialogMedia>
    <AlertDialogTitle>Cancel this stay?</AlertDialogTitle>
    <AlertDialogDescription>
      {refundNote === null ? null : `${refundNote} `}
      The nights go back on offer straight away and somebody else can take them.
      Booking them again is a new booking, not this one back.
    </AlertDialogDescription>
  </AlertDialogHeader>
);
