"use client";

import { useActionState } from "react";
import { Button } from "@repo/ui/components/button";
import { FieldError } from "@repo/ui/components/field";
import { NO_FORM_ERRORS, type FormErrors } from "#shared/lib";
import { leaveWaitlistAction } from "../api/leave-waitlist-action";

/**
 * A form with no fields and no confirmation: leaving is undone by joining again from the
 * listing, so it is the reversible case "Confirming a destructive action" leaves alone.
 */
export const LeaveWaitlistButton = ({ entryId }: { entryId: string }) => {
  const [errors, submit, pending] = useActionState<FormErrors, FormData>(
    leaveWaitlistAction.bind(null, entryId),
    NO_FORM_ERRORS,
  );

  return (
    <form action={submit} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="outline" size="sm" loading={pending}>
        Leave
      </Button>
      {errors.message !== null && <FieldError>{errors.message}</FieldError>}
    </form>
  );
};
