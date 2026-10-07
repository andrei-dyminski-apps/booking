"use client";

import { useActionState } from "react";
import { BanIcon } from "lucide-react";
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
import { setBlockedAction } from "../api/update-user-actions";

/**
 * Blocking revokes access — every session the account holds ends, and it cannot sign in
 * again — so it asks first, in the modal every such action here asks in. The form sits
 * inside the popup because the popup is portalled out of this subtree.
 *
 * Reopening an account does not ask. It is the undo of the block, and the rule here is
 * the undo rather than the danger of the word: a dialog in front of it would only add a
 * click to the way back.
 */
export const BlockButton = ({
  userId,
  email,
  blocked,
}: {
  userId: string;
  email: string;
  blocked: boolean;
}) => {
  const [errors, submit, pending] = useActionState<FormErrors, FormData>(
    setBlockedAction.bind(null, userId, !blocked),
    NO_FORM_ERRORS,
  );

  if (blocked) {
    return (
      <form action={submit} className="flex flex-col gap-1">
        <Button type="submit" variant="outline" size="sm" loading={pending}>
          Unblock
        </Button>
        {errors.message !== null && <FieldError>{errors.message}</FieldError>}
      </form>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        Block
      </AlertDialogTrigger>

      <AlertDialogContent>
        <form action={submit} className="contents">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <BanIcon className="text-destructive" />
            </AlertDialogMedia>
            <AlertDialogTitle>Block {email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every session of this account ends and it cannot sign in again
              until it is unblocked. A page already open keeps working until its
              short-lived token runs out. Its listings and stays stay where they
              are.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {errors.message !== null && <FieldError>{errors.message}</FieldError>}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              Keep access
            </AlertDialogCancel>
            <Button type="submit" variant="destructive" loading={pending}>
              Block the account
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
};
