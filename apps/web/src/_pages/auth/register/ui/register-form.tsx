"use client";

import { useState } from "react";
import { registerFormSchema, type RegisterFormInput } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { FieldError, FieldGroup } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { PasswordInput } from "@repo/ui/components/password-input";
import { useActionForm, type FormErrors } from "#shared/lib";
import { FormField } from "#shared/ui";
import { registerAction } from "../api/register-action";

/**
 * Unlike the login form beside it, this one validates in the browser first: an address
 * that is not one and a password of four characters are refused by `registerFormSchema`
 * where they were typed, and the action is only reached by a payload the contract already
 * accepts. Registration is the point where a password policy is stated, and stating it a
 * round trip after the fact is the worst place to state it.
 *
 * That costs the progressive enhancement the login form keeps — see `useActionForm` — and
 * only the login form has to keep it: somebody whose scripts never arrived cannot have
 * registered a moment ago, while somebody signing in may well have.
 */
export const RegisterForm = ({ next }: { next: string }) => {
  const [revealed, setRevealed] = useState(false);

  const { form, submit, pending, message } = useActionForm<RegisterFormInput>({
    // The second box stays in the browser: what `registerAction` takes is the payload the
    // contract describes, and a password typed twice is one password.
    action: (state: FormErrors, values: RegisterFormInput) =>
      registerAction(next, state, {
        name: values.name,
        email: values.email,
        password: values.password,
      }),
    schema: registerFormSchema,
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const { unregister } = form;

  return (
    // `method` matters for the page whose scripts never arrived: a form with neither it
    // nor an `action` submits a `GET` to its own URL, which would put a typed-in password
    // into the address bar, the history and the access log. `noValidate` is the usual
    // reason — the browser's own validation would preempt the contract with messages of
    // its own.
    <form method="post" onSubmit={submit} noValidate>
      <FieldGroup>
        <FormField
          form={form}
          name="name"
          label="Name"
          description="How hosts and the people who run the site will see you."
        >
          {(control) => (
            <Input
              {...control}
              size="lg"
              autoComplete="name"
              disabled={pending}
            />
          )}
        </FormField>

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

        <FormField
          form={form}
          name="password"
          label="Password"
          description="At least 8 characters."
        >
          {(control) => (
            <PasswordInput
              {...control}
              size="lg"
              autoComplete="new-password"
              disabled={pending}
              onRevealedChange={(shown) => {
                setRevealed(shown);

                // Putting the characters on the screen answers what the second box asks,
                // so the box goes away — and its value goes with it, or a mismatch nobody
                // can see any more would go on refusing the submit. Hiding them again
                // asks the question afresh.
                if (shown) unregister("confirmPassword");
              }}
            />
          )}
        </FormField>

        {/*
          The confirmation is only there while the password is hidden, and it has no eye of
          its own: revealing it would show a copy of what the box above is still hiding,
          which is the wrong half to put on the screen.
        */}
        {!revealed && (
          <FormField
            form={form}
            name="confirmPassword"
            label="Repeat password"
            description="Reveal the password above to skip this."
          >
            {(control) => (
              <Input
                {...control}
                type="password"
                size="lg"
                autoComplete="new-password"
                disabled={pending}
              />
            )}
          </FormField>
        )}

        {message !== null && <FieldError>{message}</FieldError>}

        <Button type="submit" size="lg" loading={pending}>
          Create account
        </Button>
      </FieldGroup>
    </form>
  );
};
