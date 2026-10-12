"use client";

import { useActionState } from "react";
import { Button } from "@repo/ui/components/button";
import { FieldError } from "@repo/ui/components/field";
import { NO_FORM_ERRORS, type FormErrors } from "#shared/lib";
import { markAllReadAction } from "../api/mark-all-read-action";

/**
 * A form with no fields, so a plain `action` — and no confirmation: nothing is lost by it,
 * every notice stays in the feed and only stops being bold.
 */
export const MarkAllReadButton = () => {
  const [errors, submit, pending] = useActionState<FormErrors, FormData>(
    markAllReadAction,
    NO_FORM_ERRORS,
  );

  return (
    <form action={submit} className="flex flex-col items-start gap-2">
      <Button type="submit" variant="outline" size="sm" loading={pending}>
        Mark all as read
      </Button>
      {errors.message !== null && <FieldError>{errors.message}</FieldError>}
    </form>
  );
};
