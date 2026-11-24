"use client";

import { useEffect, useState } from "react";
import {
  requestEmailChangeSchema,
  type RequestEmailChangeInput,
} from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import { FieldError, FieldGroup } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { PasswordInput } from "@repo/ui/components/password-input";
import { NO_FORM_ERRORS, useActionForm } from "#shared/lib";
import { FormField } from "#shared/ui";
import { requestEmailChangeAction } from "../api/request-email-change-action";

export function EmailChangeDialog() {
  const [pending, setPending] = useState(false);

  return (
    <Dialog
      onOpenChange={(_open, event) => {
        if (pending) event.cancel();
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        Change email
      </DialogTrigger>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        showCloseButton={false}
      >
        <EmailChangeForm onPendingChange={setPending} />
      </DialogContent>
    </Dialog>
  );
}

function EmailChangeForm({
  onPendingChange,
}: {
  onPendingChange: (pending: boolean) => void;
}) {
  const [requested, setRequested] = useState(false);
  const { form, submit, pending, message } =
    useActionForm<RequestEmailChangeInput>({
      action: async (_state, values) => {
        setRequested(false);
        const errors = await requestEmailChangeAction(values);
        if (errors === null) setRequested(true);
        return errors ?? NO_FORM_ERRORS;
      },
      schema: requestEmailChangeSchema,
      defaultValues: { email: "", password: "" },
    });

  useEffect(() => {
    onPendingChange(pending);
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);

  return (
    <form method="post" onSubmit={submit} noValidate className="contents">
      <DialogHeader>
        <DialogTitle>Change email</DialogTitle>
        <DialogDescription>
          Confirm the new address using the link sent to it.
        </DialogDescription>
      </DialogHeader>
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
        {requested && (
          <p role="status" className="text-sm">
            If this address is available, you’ll receive a confirmation link.
            Your current email stays active until you confirm.
          </p>
        )}
      </FieldGroup>
      <DialogFooter>
        <DialogClose disabled={pending} render={<Button variant="outline" />}>
          Close
        </DialogClose>
        <Button type="submit" loading={pending}>
          Send confirmation link
        </Button>
      </DialogFooter>
    </form>
  );
}
