"use client";

import { useState } from "react";
import {
  requestEmailChangeSchema,
  type RequestEmailChangeInput,
} from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { FieldError, FieldGroup } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { PasswordInput } from "@repo/ui/components/password-input";
import { NO_FORM_ERRORS, useActionForm } from "#shared/lib";
import { FormField } from "#shared/ui";
import { requestEmailChangeAction } from "../api/request-email-change-action";

export function EmailChangeForm() {
  const [requested, setRequested] = useState(false);
  const { form, submit, pending, message } =
    useActionForm<RequestEmailChangeInput>({
      action: async (_state, values) => {
        const errors = await requestEmailChangeAction(values);
        if (errors === null) setRequested(true);
        return errors ?? NO_FORM_ERRORS;
      },
      schema: requestEmailChangeSchema,
      defaultValues: { email: "", password: "" },
    });

  return (
    <section
      aria-labelledby="change-email-heading"
      className="grid gap-3 border-t pt-5"
    >
      <h2 id="change-email-heading" className="font-medium">
        Change email
      </h2>
      <form method="post" onSubmit={submit} noValidate>
        <FieldGroup>
          <FormField form={form} name="email" label="New email">
            {(control) => (
              <Input
                {...control}
                type="email"
                autoComplete="email"
                disabled={pending}
              />
            )}
          </FormField>
          <FormField form={form} name="password" label="Current password">
            {(control) => (
              <PasswordInput
                {...control}
                autoComplete="current-password"
                disabled={pending}
              />
            )}
          </FormField>
          {message !== null && <FieldError>{message}</FieldError>}
          <Button type="submit" variant="outline" loading={pending}>
            Send confirmation link
          </Button>
          {requested && (
            <p role="status" className="text-sm">
              If this address is available, you’ll receive a confirmation link.
              Your current email stays active until you confirm.
            </p>
          )}
        </FieldGroup>
      </form>
    </section>
  );
}
