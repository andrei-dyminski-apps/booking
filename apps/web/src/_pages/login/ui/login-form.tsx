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
import { loginAction } from "../api/login-action";
import { useSessionResume } from "../model/use-session-resume";

export const LoginForm = ({ next }: { next: string }) => {
  const resume = useSessionResume(next);
  const [errors, submit, pending] = useActionState<FormErrors, FormData>(
    loginAction.bind(null, next),
    NO_FORM_ERRORS,
  );
  // Controlled on purpose, though the action reads the request rather than these: React
  // resets an uncontrolled form once an action settles, which would wipe what the visitor
  // typed at the same moment as the message explaining what was wrong with it appears.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    // The browser's own validation would preempt the contract with messages of its own.
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
            autoComplete="current-password"
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
        </Field>

        {errors.message !== null && <FieldError>{errors.message}</FieldError>}

        <Button type="submit" size="lg" loading={pending}>
          Sign in
        </Button>

        {/*
          Beside the form rather than in place of it. The resume is a convenience for the
          visitor who is one rotation away from being signed in; hiding the form until it
          answers would put the state of a client hook between everyone else and the one
          form on this site that has to work before React has run at all.
        */}
        {resume === "checking" && (
          <FieldDescription>
            Checking whether you are already signed in…
          </FieldDescription>
        )}
      </FieldGroup>
    </form>
  );
};
