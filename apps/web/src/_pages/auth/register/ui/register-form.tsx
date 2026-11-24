"use client";

import { useState } from "react";
import { registerSchema, type RegisterInput } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { FieldError, FieldGroup } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { NO_FORM_ERRORS, useActionForm } from "#shared/lib";
import { FormField } from "#shared/ui";
import { registerAction } from "../api/register-action";

export function RegisterForm({ next }: { next: string }) {
  const [requested, setRequested] = useState(false);
  const { form, submit, pending, message } = useActionForm<RegisterInput>({
    action: async (_state, values) => {
      const errors = await registerAction({ ...values, next });
      if (errors === null) setRequested(true);
      return errors ?? NO_FORM_ERRORS;
    },
    schema: registerSchema,
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
          Send sign-up link
        </Button>
        {requested && (
          <p role="status" className="text-sm">
            If this address can be registered, you’ll receive a sign-up link
            shortly.
          </p>
        )}
      </FieldGroup>
    </form>
  );
}
