"use client";

import { useEffect, useState, type ReactElement } from "react";
import {
  BookingStatus,
  Canceller,
  type CancelBookingInput,
} from "@repo/contracts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTrigger,
} from "@repo/ui/components/alert-dialog";
import { Button } from "@repo/ui/components/button";
import { FieldError, FieldGroup } from "@repo/ui/components/field";
import { useActionForm, type FormErrors } from "#shared/lib";
import { cancelFormSchema, type CancelFormValues } from "../model/cancel-form";
import { CancelReasonField } from "./cancel-reason-field";
import { CancelStayWarning } from "./cancel-stay-warning";

type CancelAction = (
  state: FormErrors,
  values: CancelBookingInput,
) => Promise<FormErrors>;

/**
 * The confirmation both screens that cancel a stay open, with the box for the reason —
 * required of the host. How the request is sent stays with each page: it hands over the
 * action, already bound, and what to do once it has cancelled.
 *
 * The form lives inside the popup, which Base UI unmounts on closing, so every opening
 * starts clean — a refusal from the last attempt, a message under the box and a half-typed
 * reason go with the popup. It stays open while the request is on its way and with the
 * reason in it on a refusal: a cancellation decides a refund, so a screen says `Cancelled`
 * only once the API has.
 *
 * A host's cancellation of a hold nobody has paid for is declining a request, and is worded
 * so; the guest and an admin cancel either.
 */
export const CancelStayDialog = ({
  canceller,
  status,
  refundNote,
  action,
  onCancelled,
  trigger,
  short = false,
}: {
  /** Who the viewer cancels as — `cancellerOf`, as the API decides. */
  canceller: Canceller;
  status: BookingStatus;
  /** What the cancellation gives back or costs, worded for the viewer. */
  refundNote: string | null;
  action: CancelAction;
  /** After the API cancelled: the dialog has closed by then. */
  onCancelled?: () => void;
  /** The trigger's look, a `Button`; its words are the dialog's. */
  trigger: ReactElement;
  /** "Cancel" on a card among other stays, "Cancel the stay" where it is the whole page. */
  short?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const declining =
    canceller === Canceller.HOST && status === BookingStatus.PENDING_PAYMENT;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;

        setOpen(next);
      }}
    >
      <AlertDialogTrigger render={trigger}>
        {triggerLabel(canceller, declining, short)}
      </AlertDialogTrigger>

      <AlertDialogContent>
        <CancelStayForm
          canceller={canceller}
          declining={declining}
          refundNote={refundNote}
          action={action}
          onPendingChange={setPending}
          onSuccess={() => {
            setOpen(false);
            onCancelled?.();
          }}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
};

const CancelStayForm = ({
  canceller,
  declining,
  refundNote,
  action,
  onPendingChange,
  onSuccess,
}: {
  canceller: Canceller;
  declining: boolean;
  refundNote: string | null;
  action: CancelAction;
  onPendingChange: (pending: boolean) => void;
  onSuccess: () => void;
}) => {
  const { form, submit, pending, message } = useActionForm<
    CancelFormValues,
    CancelBookingInput
  >({
    action,
    schema: cancelFormSchema(canceller === Canceller.HOST),
    defaultValues: { reason: "" },
    onSuccess,
  });

  // The dialog above refuses to close while a request is out, and only this form knows
  // whether one is. Unmounting — a success closes the dialog mid-request — clears it.
  useEffect(() => {
    onPendingChange(pending);

    return () => {
      onPendingChange(false);
    };
  }, [pending, onPendingChange]);

  return (
    // `method` and `noValidate` for the reasons `booking-form.tsx` gives; `contents` keeps
    // the grid of the dialog intact around the form.
    <form method="post" onSubmit={submit} noValidate className="contents">
      <CancelStayWarning
        title={declining ? "Decline this request?" : "Cancel this stay?"}
        refundNote={refundNote}
      />

      <FieldGroup>
        <CancelReasonField
          form={form}
          canceller={canceller}
          declining={declining}
          pending={pending}
        />
        {message !== null && <FieldError>{message}</FieldError>}
      </FieldGroup>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
        <Button type="submit" variant="destructive" loading={pending}>
          {declining ? "Decline the request" : "Cancel the stay"}
        </Button>
      </AlertDialogFooter>
    </form>
  );
};

function triggerLabel(
  canceller: Canceller,
  declining: boolean,
  short: boolean,
): string {
  if (declining) return short ? "Decline" : "Decline the request";

  if (canceller === Canceller.HOST) {
    return short ? "Cancel as host" : "Cancel the stay as host";
  }

  return short ? "Cancel" : "Cancel the stay";
}
