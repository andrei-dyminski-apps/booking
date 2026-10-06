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
import { deleteListingAction } from "../api/delete-listing-action";

/**
 * Deleting a listing cannot be undone, so the second click happens in a modal rather than
 * in a button that swapped places with the first one: an alert dialog takes the focus and
 * refuses a click outside itself, which is what stops the confirmation being hit by the
 * hand that was already moving.
 *
 * The form sits inside the popup because the popup is portalled out of this subtree — a
 * submit button left behind in a form up here would no longer belong to it. `contents`
 * keeps the grid of the dialog intact around it.
 *
 * The dialog stays open when the action comes back with a message — a `404` for a row
 * somebody else retired first, or an unreachable API — because that reason belongs next to
 * the button that provoked it. A success never gets here: the action redirects to the
 * section the author manages listings from.
 *
 * A feature because two screens run it: the owner's edit screen and the admin's.
 */
export const DeleteListingButton = ({ listingId }: { listingId: string }) => {
  const [errors, submit, pending] = useActionState<FormErrors, FormData>(
    deleteListingAction.bind(null, listingId),
    NO_FORM_ERRORS,
  );

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="lg" />}>
        Delete listing
      </AlertDialogTrigger>

      <AlertDialogContent>
        <form action={submit} className="contents">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlertIcon className="text-destructive" />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete this listing?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. It leaves the catalogue and its
              owner&apos;s dashboard for good and takes no new bookings. Stays
              already booked against it keep their record.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {errors.message !== null && <FieldError>{errors.message}</FieldError>}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <Button type="submit" variant="destructive" loading={pending}>
              Delete permanently
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
};
