"use client";

import { useActionState } from "react";
import type { AdminRefundInput } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { FieldDescription, FieldError } from "@repo/ui/components/field";
import { NO_FORM_ERRORS } from "#shared/lib";
import { refundStayAction } from "../api/refund-stay-action";
import type { RefundErrors } from "../model/refund-form";

/**
 * A press Stripe never answered, pressed again under its own request: the API records the
 * refund if it went out, or sends it now — never a second one, whatever this button is
 * pressed for. It does not ask first: the admin who claimed it asked for this refund already,
 * and the claim holds its amount. A form with no fields, so a plain `action={submit}` over
 * the press it is handed, as the retry buttons of the payments screen are.
 *
 * A refusal stays beside the button; the action's `refresh()` redraws the list, without the
 * row when the API let the claim go, or with the refund it recorded — and then `onRefunded`
 * has the page wait for its webhook, as a refund from the dialog does.
 */
export const FinishRefundButton = ({
  bookingId,
  press,
  onRefunded,
}: {
  bookingId: string;
  /** The claimed press: its amount, its reason and its request id, as the row has them. */
  press: AdminRefundInput;
  /** After the API recorded or sent the refund. */
  onRefunded: () => void;
}) => {
  const [errors, submit, pending] = useActionState<RefundErrors, FormData>(
    async (state) => {
      const answer = await refundStayAction(bookingId, state, press);

      if (answer.message === null && Object.keys(answer.fields).length === 0) {
        onRefunded();
      }

      return answer;
    },
    { ...NO_FORM_ERRORS, uncertain: false },
  );

  return (
    <form
      action={submit}
      className="flex w-full flex-col gap-1 pt-1 sm:w-auto sm:items-start"
    >
      <FieldDescription>
        Stripe never answered this refund. Finishing it records the refund if it
        went out, or sends it now — never a second one.
      </FieldDescription>
      <Button
        type="submit"
        variant="outline"
        size="sm"
        loading={pending}
        className="w-full sm:w-auto"
      >
        Finish the refund
      </Button>
      {errors.message !== null && <FieldError>{errors.message}</FieldError>}
    </form>
  );
};
