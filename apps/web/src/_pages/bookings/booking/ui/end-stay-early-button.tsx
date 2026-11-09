"use client";

import { useActionState, useEffect, useState } from "react";
import { DoorOpenIcon } from "lucide-react";
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
import { endStayEarlyAction } from "../api/end-stay-early-action";
import type { EarlyEndTerms } from "../model/early-end-note";

/**
 * Ending a stay early, for its guest or an admin. Nothing brings the nights back once they
 * are on offer again, so it asks first, in the modal every irreversible action here asks in.
 * The form lives inside the popup, which Base UI unmounts on closing, so every opening starts
 * clean — a refusal from the last attempt goes with the popup, as in `cancel-stay-dialog.tsx`.
 * It stays open on a refusal, and on success closes and has the page read the stay again —
 * not optimistic, since it decides a refund.
 *
 * The terms are taken when the dialog opens and held while it is open: the page's clock moves
 * on at midnight and its poll may read a refund in, and a sentence rewritten under the reader
 * would be agreed to unread. So a dialog left open past midnight UTC or past a refund still
 * sends the terms it states, and the API refuses them (`409`). The refusal is what restates
 * them: the page reads the stay again, the dialog shows the terms of now beside the API's
 * words from then on, and a second press agrees to those. A stay that has stopped being
 * endable meanwhile — the day turned onto its last night — keeps the dialog up with the API's
 * reason, and nothing left to press.
 */
export const EndStayEarlyButton = ({
  bookingId,
  terms,
  onOpenChange,
  onRefused,
  onEnded,
}: {
  bookingId: string;
  /**
   * What ending the stay now does — `earlyEndTerms` — or `null` once it can no longer end
   * early. The page keeps this mounted while the dialog is open, so `null` reaches an open
   * dialog rather than taking it away.
   */
  terms: EarlyEndTerms | null;
  /** Whether the dialog is open, so the page keeps it mounted until it closes. */
  onOpenChange: (open: boolean) => void;
  /** After a refusal: the page reads the stay again, so the terms of now reach the dialog. */
  onRefused: () => void;
  /** After the API ended it: the dialog has closed by then. */
  onEnded: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [held, setHeld] = useState<EarlyEndTerms | null>(terms);
  // After a refusal the dialog follows the page's terms, which the refusal has just made
  // news; before one it holds what it opened with.
  const [refused, setRefused] = useState(false);
  const stated = refused ? (terms ?? held) : held;

  const change = (next: boolean) => {
    if (pending) return;

    if (next) {
      setHeld(terms);
      setRefused(false);
    }

    setOpen(next);
    onOpenChange(next);
  };

  return (
    <AlertDialog open={open} onOpenChange={change}>
      {terms !== null && (
        <AlertDialogTrigger
          render={<Button variant="outline" className="w-full sm:w-auto" />}
        >
          End stay early
        </AlertDialogTrigger>
      )}

      <AlertDialogContent>
        {stated !== null && (
          <EndStayEarlyForm
            bookingId={bookingId}
            terms={stated}
            withdrawn={refused && terms === null}
            onPendingChange={setPending}
            onRefused={() => {
              setRefused(true);
              onRefused();
            }}
            onSuccess={() => {
              setOpen(false);
              onOpenChange(false);
              onEnded();
            }}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
};

/** A form with no fields, so a plain `action` over `useActionState`. */
const EndStayEarlyForm = ({
  bookingId,
  terms,
  withdrawn,
  onPendingChange,
  onRefused,
  onSuccess,
}: {
  bookingId: string;
  terms: EarlyEndTerms;
  /** Refused, and no longer endable: the API's reason stays, with nothing to press. */
  withdrawn: boolean;
  onPendingChange: (pending: boolean) => void;
  onRefused: () => void;
  onSuccess: () => void;
}) => {
  const [errors, submit, pending] = useActionState<FormErrors, FormData>(
    async () => {
      const answer = await endStayEarlyAction(bookingId, terms);

      if (answer.message === null) onSuccess();
      else onRefused();

      return answer;
    },
    NO_FORM_ERRORS,
  );

  // The dialog above refuses to close while a request is out, and only this form knows
  // whether one is. Unmounting — a success closes the dialog mid-request — clears it.
  useEffect(() => {
    onPendingChange(pending);

    return () => {
      onPendingChange(false);
    };
  }, [pending, onPendingChange]);

  return (
    <form action={submit} className="contents">
      <AlertDialogHeader>
        <AlertDialogMedia>
          <DoorOpenIcon className="text-destructive" />
        </AlertDialogMedia>
        <AlertDialogTitle>End this stay early?</AlertDialogTitle>
        <AlertDialogDescription>
          {terms.note} Tonight is part of the stay. Somebody else can book the
          nights after it straight away.
        </AlertDialogDescription>
      </AlertDialogHeader>

      {errors.message !== null && <FieldError>{errors.message}</FieldError>}

      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>
          {withdrawn ? "Close" : "Keep staying"}
        </AlertDialogCancel>
        {!withdrawn && (
          <Button type="submit" variant="destructive" loading={pending}>
            End the stay
          </Button>
        )}
      </AlertDialogFooter>
    </form>
  );
};
