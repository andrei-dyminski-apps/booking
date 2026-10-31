"use client";

import { useActionState } from "react";
import { RotateCwIcon } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { FieldError } from "@repo/ui/components/field";
import { NO_FORM_ERRORS, type FormErrors } from "#shared/lib";

/**
 * Handing something set aside back to the job that gave up on it. It does not ask first:
 * the handlers are idempotent and the job sends nothing it has sent before, so a retry
 * changes nothing a person would want to undo. A form with no fields, so a plain
 * `action={submit}` over the bound action, as the block button's undo is.
 *
 * A refusal — another admin retried it first, an unreachable API — stays beside the button.
 * A success re-renders the list without the row.
 */
export const RetryButton = ({
  action,
}: {
  /** Already bound to the row by the card. */
  action: () => Promise<FormErrors>;
}) => {
  const [errors, submit, pending] = useActionState<FormErrors, FormData>(
    action,
    NO_FORM_ERRORS,
  );

  return (
    <form
      action={submit}
      className="flex w-full flex-col gap-1 sm:w-auto sm:items-end"
    >
      <Button
        type="submit"
        variant="outline"
        size="sm"
        loading={pending}
        className="w-full sm:w-auto"
      >
        <RotateCwIcon />
        Retry now
      </Button>
      {errors.message !== null && <FieldError>{errors.message}</FieldError>}
    </form>
  );
};
