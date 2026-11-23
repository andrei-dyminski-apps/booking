"use client";

import { useState } from "react";
import { requestPasswordResetSchema } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { FieldError, FieldGroup } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { NO_FORM_ERRORS, useActionForm } from "#shared/lib";
import { FormField } from "#shared/ui";
import { requestPasswordResetAction } from "../api/request-password-reset-action";

export function ForgotPasswordForm() {
  const [requested, setRequested] = useState(false);
  const { form, submit, pending, message } = useActionForm({
    action: async (_state, { email }) => {
      const errors = await requestPasswordResetAction(email);
      if (errors === null) setRequested(true);
      return errors ?? NO_FORM_ERRORS;
    },
    schema: requestPasswordResetSchema,
    defaultValues: { email: "" },
  });

  return (
    <form method="post" onSubmit={submit} noValidate>
      <FieldGroup>
        <FormField form={form} name="email" label="Email">
          {(control) => (
            <Input
              {...control}
              type="email"
              size="lg"
              autoComplete="email"
              disabled={pending}
            />
          )}
        </FormField>
        {message !== null && <FieldError>{message}</FieldError>}
        <Button type="submit" size="lg" loading={pending}>
          Send reset link
        </Button>
        {requested && (
          <p role="status" className="text-sm">
            If a reset is available for this address, you’ll receive a link
            shortly.
          </p>
        )}
      </FieldGroup>
    </form>
  );
}
