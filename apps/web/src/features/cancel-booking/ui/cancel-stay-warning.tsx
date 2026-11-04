import { TriangleAlertIcon } from "lucide-react";
import {
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog";

/**
 * What every dialog that cancels a stay says before it does: what comes back or what it
 * costs, and that the nights do not come back with it. One copy for the list of stays and
 * the stay's own page — the warning about an irreversible step and the refund policy have
 * to read the same on both.
 */
export const CancelStayWarning = ({
  title,
  refundNote,
}: {
  title: string;
  /**
   * What the cancellation gives back, or what it costs the host, worded for the viewer —
   * `cancellationRefundNote`.
   */
  refundNote: string | null;
}) => (
  <AlertDialogHeader>
    <AlertDialogMedia>
      <TriangleAlertIcon className="text-destructive" />
    </AlertDialogMedia>
    <AlertDialogTitle>{title}</AlertDialogTitle>
    <AlertDialogDescription>
      {refundNote === null ? null : `${refundNote} `}
      The nights go back on offer straight away and somebody else can take them.
      Booking them again is a new booking, not this one back.
    </AlertDialogDescription>
  </AlertDialogHeader>
);
