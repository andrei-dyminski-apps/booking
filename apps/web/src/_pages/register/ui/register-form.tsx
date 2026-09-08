"use client";

import { registerSchema, type RegisterInput } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { FieldError, FieldGroup } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { PasswordInput } from "@repo/ui/components/password-input";
import { useActionForm } from "#shared/lib";
import { FormField } from "#shared/ui";
import { registerAction } from "../api/register-action";

/**
 * Unlike the login form beside it, this one validates in the browser first: an address
 * that is not one and a password of four characters are refused by `registerSchema` where
 * they were typed, and the action is only reached by a payload the contract already
 * accepts. Registration is the point where a password policy is stated, and stating it a
 * round trip after the fact is the worst place to state it.
 *
 * That costs the progressive enhancement the login form keeps — see `useActionForm` — and
 * only the login form has to keep it: somebody whose scripts never arrived cannot have
 * registered a moment ago, while somebody signing in may well have.
 */
export const RegisterForm = ({ next }: { next: string }) => {
  const { form, submit, pending, message } = useActionForm<RegisterInput>({
    action: registerAction.bind(null, next),
    schema: registerSchema,
    defaultValues: { email: "", password: "" },
  });

  return (
    // `method` matters for the page whose scripts never arrived: a form with neither it
    // nor an `action` submits a `GET` to its own URL, which would put a typed-in password
    // into the address bar, the history and the access log. `noValidate` is the usual
    // reason — the browser's own validation would preempt the contract with messages of
    // its own.
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
            />
          )}
        </FormField>

        {message !== null && <FieldError>{message}</FieldError>}

        <Button type="submit" size="lg" loading={pending}>
          Create account
        </Button>
      </FieldGroup>
    </form>
  );
};
