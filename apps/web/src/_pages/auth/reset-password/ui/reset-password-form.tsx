"use client";

import { useEffect } from "react";
import { resetPasswordSchema, type ResetPasswordInput } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { FieldError, FieldGroup } from "@repo/ui/components/field";
import { PasswordInput } from "@repo/ui/components/password-input";
import { useActionForm } from "#shared/lib";
import { FormField } from "#shared/ui";
import { resetPasswordAction } from "../api/reset-password-action";

export function ResetPasswordForm() {
  const { form, submit, pending, message } = useActionForm<ResetPasswordInput>({
    action: (_state, values) => resetPasswordAction(values),
    schema: resetPasswordSchema,
    defaultValues: { password: "", token: "" },
  });
  const {
    setValue,
    formState: { errors },
  } = form;
  useEffect(() => {
    setValue("token", window.location.hash.slice(1));
  }, [setValue]);

  return (
    <form method="post" onSubmit={submit} noValidate>
      <FieldGroup>
        <FormField
          form={form}
          name="password"
          label="New password"
          description="At least 8 characters."
        >
          {(control) => (
            <PasswordInput
              {...control}
              size="lg"
              autoComplete="new-password"
              disabled={pending}
            />
          )}
        </FormField>
        {errors.token && (
          <FieldError>This link is invalid or expired.</FieldError>
        )}
        {message !== null && <FieldError>{message}</FieldError>}
        <Button type="submit" size="lg" loading={pending}>
          Reset password
        </Button>
      </FieldGroup>
    </form>
  );
}
