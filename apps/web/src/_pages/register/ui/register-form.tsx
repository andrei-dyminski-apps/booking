"use client";

import { useActionState, useState } from "react";
import { Button } from "@repo/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { NO_FORM_ERRORS, type FormErrors } from "#shared/lib";
import { registerAction } from "../api/register-action";

export const RegisterForm = ({ next }: { next: string }) => {
  const [errors, submit, pending] = useActionState<FormErrors, FormData>(
    registerAction.bind(null, next),
    NO_FORM_ERRORS,
  );
  // Controlled for the same reason as the login form: an action that comes back with a
  // refusal must not take the typed-in values away with it.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <form action={submit} noValidate>
      <FieldGroup>
        <Field data-invalid={errors.fields.email !== undefined}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            aria-invalid={errors.fields.email !== undefined}
            disabled={pending}
          />
          <FieldError
            errors={errors.fields.email?.map((message) => ({ message }))}
          />
        </Field>

        <Field data-invalid={errors.fields.password !== undefined}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            aria-invalid={errors.fields.password !== undefined}
            disabled={pending}
          />
          <FieldError
            errors={errors.fields.password?.map((message) => ({ message }))}
          />
          <FieldDescription>At least 8 characters.</FieldDescription>
        </Field>

        {errors.message !== null && <FieldError>{errors.message}</FieldError>}

        <Button type="submit" size="lg" loading={pending}>
          Create account
        </Button>
      </FieldGroup>
    </form>
  );
};
