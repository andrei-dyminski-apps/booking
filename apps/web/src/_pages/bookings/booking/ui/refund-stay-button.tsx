"use client";

import { useEffect, useState } from "react";
import {
  adminRefundSchema,
  type AdminRefundInput,
  type Cents,
  type Currency,
} from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import {
  FieldDescription,
  FieldError,
  FieldGroup,
} from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { formatMoney, useActionForm } from "#shared/lib";
import { FormField } from "#shared/ui";
import { refundStayAction } from "../api/refund-stay-action";
import { refundFormSchema, type RefundFormValues } from "../model/refund-form";

/**
 * An admin giving back part of a stay without cancelling it — the hot water that was off for
 * two nights. A box somebody types into, so `useActionForm` over `refundFormSchema`, the
 * contract's body with the amount typed in the currency.
 *
 * The form lives inside the popup, which Base UI unmounts on closing, so every opening mints
 * a request id of its own and every press while it is open sends that one: a second press,
 * or one after an answer that never came back, is the same refund at the provider rather
 * than a second one. It stays open while the request is out, and closes once the API has
 * refunded; `refresh()` then lists the refund under the stay, and `onRefunded` has the page
 * read the stay until the webhook reports the refund, so the ceiling stated here drops by it.
 */
export const RefundStayButton = ({
  bookingId,
  refundableCents,
  currency,
  keepsLastCent,
  onRefunded,
}: {
  bookingId: string;
  /** What is left to give back — `refundableCents`, stated before the button. */
  refundableCents: Cents;
  currency: Currency;
  /** The stay has not begun, so `refundableCents` keeps its last cent back. */
  keepsLastCent: boolean;
  /** After the API refunded — the page waits for its webhook; the dialog has closed by then. */
  onRefunded?: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;

        setOpen(next);
      }}
    >
      <DialogTrigger
        render={<Button variant="outline" className="w-full sm:w-auto" />}
      >
        Refund part
      </DialogTrigger>

      <DialogContent>
        <RefundStayForm
          bookingId={bookingId}
          left={formatMoney(refundableCents, currency)}
          keepsLastCent={keepsLastCent}
          onPendingChange={setPending}
          onSuccess={() => {
            setOpen(false);
            onRefunded?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
};

const RefundStayForm = ({
  bookingId,
  left,
  keepsLastCent,
  onPendingChange,
  onSuccess,
}: {
  bookingId: string;
  /** What is left to give back, formatted. */
  left: string;
  keepsLastCent: boolean;
  onPendingChange: (pending: boolean) => void;
  onSuccess: () => void;
}) => {
  // One per opening: the form mounts with the popup.
  const [requestId] = useState(() => crypto.randomUUID());
  // Once nobody could say whether the refund went out, the boxes hold what was sent until the
  // dialog closes: pressing again is then the same request. A later 4xx does not let them go
  // — a stay another request holds, or a claim too young to release, says nothing about the
  // claim an earlier press left, and that claim refuses another amount anyway.
  const [held, setHeld] = useState(false);
  const { form, submit, pending, message } = useActionForm<
    RefundFormValues,
    AdminRefundInput
  >({
    action: async (state, values) => {
      try {
        const answer = await refundStayAction(bookingId, state, values);

        if (answer.uncertain) setHeld(true);

        return answer;
      } catch (error) {
        // The call itself failed — `useActionForm` words a lost connection — and the request
        // may have landed before it went.
        setHeld(true);

        throw error;
      }
    },
    schema: refundFormSchema,
    defaultValues: { amountCents: "", reason: "" },
    bound: { requestId },
    onSuccess,
  });

  // The dialog above refuses to close while a request is out, and only this form knows
  // whether one is, as in the cancel dialog.
  useEffect(() => {
    onPendingChange(pending);

    return () => {
      onPendingChange(false);
    };
  }, [pending, onPendingChange]);

  return (
    // `method` and `noValidate` for the reasons `booking-form.tsx` gives.
    <form
      method="post"
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-6"
    >
      <DialogHeader>
        <DialogTitle>Refund part of this stay?</DialogTitle>
        <DialogDescription>
          The money goes back to the card the stay was paid with, and the stay
          stays as it is. At most {left} is left to refund
          {keepsLastCent
            ? " — the stay has not begun, so its last cent stays: refunding all of it is cancelling it."
            : "."}{" "}
          A refund sent a moment ago counts here only once Stripe reports it;
          the refund itself is measured against what Stripe has given back
          already.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <FormField
          form={form}
          name="amountCents"
          label="Amount"
          description="To the cent: 50.25 is fifty dollars and twenty-five cents."
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="decimal"
              // The cent is the scale the contract refuses to go finer than.
              step="0.01"
              min="0.01"
              readOnly={held}
              disabled={pending}
            />
          )}
        </FormField>

        <FormField
          form={form}
          name="reason"
          label="Reason"
          limit={adminRefundSchema.shape.reason.maxLength}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              readOnly={held}
              disabled={pending}
            />
          )}
        </FormField>

        {message !== null && <FieldError>{message}</FieldError>}
        {held && (
          <FieldDescription>
            The refund may have gone out. Press again: it records the refund
            that went out, or sends this same one — it cannot become a second
            one. If it reached Stripe, it is also listed below the stay as
            unconfirmed, where it can be finished after this dialog is closed.
            Another amount is a new refund: close this dialog and open it again.
          </FieldDescription>
        )}
      </FieldGroup>

      <DialogFooter>
        <Button type="submit" loading={pending}>
          Send the refund
        </Button>
      </DialogFooter>
    </form>
  );
};
