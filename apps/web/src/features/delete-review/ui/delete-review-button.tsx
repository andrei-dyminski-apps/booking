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
import { deleteReviewAction } from "../api/delete-review-action";

/**
 * The admin's removal of a review, on both screens that list them — a listing's page and a
 * guest's. Nothing brings a removed review back, so it asks first, in the modal every
 * irreversible action here asks in; the form sits inside the popup for the reason
 * `cancel-booking-button.tsx` gives.
 */
export const DeleteReviewButton = ({
  reviewId,
  listingId,
}: {
  reviewId: string;
  /** The listing whose cached reviews forget this one — `null` on a guest's page. */
  listingId: string | null;
}) => {
  const [errors, submit, pending] = useActionState<FormErrors, FormData>(
    deleteReviewAction.bind(null, reviewId, listingId),
    NO_FORM_ERRORS,
  );

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        Remove
      </AlertDialogTrigger>

      <AlertDialogContent>
        <form action={submit} className="contents">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlertIcon className="text-destructive" />
            </AlertDialogMedia>
            <AlertDialogTitle>Remove this review?</AlertDialogTitle>
            <AlertDialogDescription>
              It disappears for everybody and stops counting towards the rating.
              Its author may then review the same stay again.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {errors.message !== null && <FieldError>{errors.message}</FieldError>}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <Button type="submit" variant="destructive" loading={pending}>
              Remove the review
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
};
