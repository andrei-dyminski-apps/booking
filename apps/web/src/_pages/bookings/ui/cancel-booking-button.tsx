"use client";

import { useActionState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/ui/components/alert-dialog";
import { Button } from "@repo/ui/components/button";
import { FieldError } from "@repo/ui/components/field";
import { NO_FORM_ERRORS, type FormErrors } from "#shared/lib";
import { cancelBookingAction } from "../api/cancel-booking-action";

/**
 * Cancelling is terminal — the API moves the row to `CANCELLED` and refuses a second
 * attempt — so it asks first, in the modal every irreversible action here asks in. The
 * form sits inside the popup because the popup is portalled out of this subtree, and
 * `contents` keeps the grid of the dialog intact around it.
 *
 * A refusal keeps the dialog open with the reason in it. A success does not redirect
 * either: the row stays where it is and says `Cancelled` once `refresh()` has re-rendered
 * the list behind the closing dialog.
 */
export const CancelBookingButton = ({
  bookingId,
  listingId,
}: {
  bookingId: string;
  listingId: string;
}) => {
  const [errors, submit, pending] = useActionState<FormErrors, FormData>(
    cancelBookingAction.bind(null, bookingId, listingId),
    NO_FORM_ERRORS,
  );

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        Cancel
      </AlertDialogTrigger>

      <AlertDialogContent>
        <form action={submit} className="contents">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlertIcon className="text-destructive" />
            </AlertDialogMedia>
            <AlertDialogTitle>Cancel this stay?</AlertDialogTitle>
            <AlertDialogDescription>
              The nights go back on offer straight away and somebody else can
              take them. Booking them again is a new booking, not this one back.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {errors.message !== null && <FieldError>{errors.message}</FieldError>}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <Button type="submit" variant="destructive" loading={pending}>
              Cancel the stay
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
};
