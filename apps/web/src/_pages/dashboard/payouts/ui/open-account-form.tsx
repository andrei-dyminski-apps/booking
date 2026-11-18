"use client";

import { useMemo } from "react";
import { useController } from "react-hook-form";
import {
  openPayoutAccountSchema,
  type OpenPayoutAccountInput,
} from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { Field, FieldError, FieldGroup } from "@repo/ui/components/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { fieldMessages, messagesOf, useActionForm } from "#shared/lib";
import { HintLabel, hintOf } from "#shared/ui";
import { openAccountAction } from "../api/open-account-action";
import type { CountryOption } from "../lib/country-options";

const ID = "field-country";

/**
 * The step before Stripe's onboarding: the country the host's payout account is opened in.
 * Stripe fixes it when the account is opened and asks for that country's details, so the
 * host picks it here once. A controller rather than `FormField`'s `register`, for the reason
 * `PolicyField` gives: the design system's `Select` is a listbox, not a native box.
 */
export const OpenAccountForm = ({
  countries,
}: {
  countries: CountryOption[];
}) => {
  const { form, submit, pending, message } =
    useActionForm<OpenPayoutAccountInput>({
      action: openAccountAction,
      schema: openPayoutAccountSchema,
      defaultValues: { country: undefined },
    });
  const {
    field: { ref, value },
    fieldState,
  } = useController({ control: form.control, name: "country" });
  const messages = messagesOf(fieldState.error);
  const hint = hintOf(
    ID,
    "Where you live, or where your business is registered. Stripe asks for that country's details, pays out in its currency, and it cannot be changed later.",
  );
  const errorId = messages === undefined ? undefined : `${ID}-error`;
  // What the trigger shows for the value picked; built once, not on every keystroke's render.
  const items = useMemo(
    () =>
      Object.fromEntries(
        countries.map((country) => [country.value, country.label]),
      ),
    [countries],
  );

  return (
    // `method` and `noValidate` for the reasons `booking-form.tsx` gives.
    <form
      method="post"
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-6 rounded-xl border p-4 sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">Set up payouts</h2>
        <p className="text-sm text-muted-foreground">
          Choose your country to continue to Stripe&apos;s onboarding form.
        </p>
      </div>

      <FieldGroup>
        <Field data-invalid={fieldState.invalid}>
          <HintLabel htmlFor={ID} label="Country" hint={hint} />
          <Select
            // A country the list has dropped since the pick (`refresh()` after the API's
            // refusal) shows the placeholder, not its bare code, beside the refusal under it.
            value={
              value !== undefined && Object.hasOwn(items, value) ? value : null
            }
            // Judged as it is picked rather than on blur: opening the list takes the focus
            // off the trigger, and `onBlur` would refuse the empty box while the list is open
            // and keep refusing it after a pick, since the form re-judges on change only once
            // submitted.
            onValueChange={(picked) => {
              if (picked !== null) {
                form.setValue("country", picked, { shouldValidate: true });
              }
            }}
            items={items}
            disabled={pending}
          >
            <SelectTrigger
              id={ID}
              ref={ref}
              aria-invalid={fieldState.invalid}
              aria-describedby={
                [hint?.id, errorId].filter(Boolean).join(" ") || undefined
              }
              className="h-10 w-full min-w-0 text-base sm:max-w-sm md:text-sm"
            >
              <SelectValue placeholder="Choose a country" />
            </SelectTrigger>
            <SelectContent>
              {countries.map((country) => (
                <SelectItem key={country.value} value={country.value}>
                  {country.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError id={errorId} errors={fieldMessages(messages)} />
        </Field>

        {message !== null && <FieldError>{message}</FieldError>}
      </FieldGroup>

      <div>
        <Button type="submit" loading={pending} className="w-full sm:w-auto">
          Continue
        </Button>
      </div>
    </form>
  );
};
