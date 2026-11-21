"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { Trash2Icon } from "lucide-react";
import {
  OPEN_MATTER_MESSAGES,
  deleteAccountSchema,
  type DeleteAccountInput,
  type OpenMattersParams,
} from "@repo/contracts";
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
import { FieldError, FieldGroup } from "@repo/ui/components/field";
import { PasswordInput } from "@repo/ui/components/password-input";
import { useActionForm, type FormErrors } from "#shared/lib";
import { FormField } from "#shared/ui";
import { deleteAccountAction } from "../api/delete-account-action";
import { openMatterLinks } from "../model/open-matter-links";

/**
 * The confirmation in front of erasing the account — the one thing on this site nobody can
 * undo, so it asks in the modal every destructive action asks in, and asks for the password
 * as well: the API refuses the erasure without it.
 *
 * The form lives inside the popup, which Base UI unmounts on closing, so every opening
 * starts clean. It stays open while the request is out and on a refusal, which belongs
 * beside the button that provoked it: a wrong password under its box, and what is still
 * open on the account as a list with a link to each, so the visitor knows what to finish.
 * A success never comes back here — the action redirects to the home page's notice.
 */
export const DeleteAccountDialog = () => {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;

        setOpen(next);
      }}
    >
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        Delete account
      </AlertDialogTrigger>

      <AlertDialogContent>
        <DeleteAccountForm onPendingChange={setPending} />
      </AlertDialogContent>
    </AlertDialog>
  );
};

const DeleteAccountForm = ({
  onPendingChange,
}: {
  onPendingChange: (pending: boolean) => void;
}) => {
  const [openMatters, setOpenMatters] = useState<OpenMattersParams | null>(
    null,
  );
  const { form, submit, pending, message } = useActionForm<DeleteAccountInput>({
    action: async (state: FormErrors, values: DeleteAccountInput) => {
      // Cleared first, so an attempt that never gets an answer — the connection lost —
      // shows its own message rather than the list an earlier refusal left.
      setOpenMatters(null);

      const answer = await deleteAccountAction(state, values);

      setOpenMatters(answer.matters);

      return answer;
    },
    schema: deleteAccountSchema,
    defaultValues: { password: "" },
  });

  // The dialog above refuses to close while a request is out, and only this form knows
  // whether one is.
  useEffect(() => {
    onPendingChange(pending);

    return () => {
      onPendingChange(false);
    };
  }, [pending, onPendingChange]);

  return (
    // `method` and `noValidate` for the reasons `booking-form.tsx` gives — here the box is
    // a password, which a `GET` would put in the address bar; `contents` keeps the grid of
    // the dialog intact around the form.
    <form method="post" onSubmit={submit} noValidate className="contents">
      <AlertDialogHeader>
        <AlertDialogMedia>
          <Trash2Icon className="text-destructive" />
        </AlertDialogMedia>
        <AlertDialogTitle>Delete your account?</AlertDialogTitle>
        <AlertDialogDescription>
          This cannot be undone. Type your password to confirm.
        </AlertDialogDescription>
      </AlertDialogHeader>

      <FieldGroup>
        <FormField form={form} name="password" label="Password">
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="current-password"
              disabled={pending}
            />
          )}
        </FormField>

        {openMatters !== null ? (
          <OpenMatters matters={openMatters} />
        ) : (
          message !== null && <FieldError>{message}</FieldError>
        )}
      </FieldGroup>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>
          Keep my account
        </AlertDialogCancel>
        <Button type="submit" variant="destructive" loading={pending}>
          Delete my account
        </Button>
      </AlertDialogFooter>
    </form>
  );
};

/**
 * What keeps the account open, each with where to put it right — a stay open on both
 * halves of the stays links both tabs. An alert, so it is announced the way a form's
 * message is; a list, since there can be several.
 */
const OpenMatters = ({ matters }: { matters: OpenMattersParams }) => (
  <div role="alert" className="flex flex-col gap-2 text-sm">
    <p className="font-medium text-destructive">
      Your account cannot be deleted yet. Finish these first:
    </p>
    <ul role="list" className="flex list-disc flex-col gap-1 pl-5">
      {matters.open.map((matter) => (
        <li key={matter}>
          {OPEN_MATTER_MESSAGES[matter]}.{" "}
          {openMatterLinks(matter, matters).map((link, index) => (
            <Fragment key={link.href}>
              {index > 0 && " · "}
              <Link href={link.href} className="underline underline-offset-4">
                {link.label}
              </Link>
            </Fragment>
          ))}
        </li>
      ))}
    </ul>
  </div>
);
