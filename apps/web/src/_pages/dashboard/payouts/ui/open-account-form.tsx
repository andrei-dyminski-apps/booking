"use client";

import { useController } from "react-hook-form";
import {
  openPayoutAccountSchema,
  type OpenPayoutAccountInput,
} from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@repo/ui/components/combobox";
import { Field, FieldError, FieldGroup } from "@repo/ui/components/field";
import { fieldMessages, messagesOf, useActionForm } from "#shared/lib";
import { HintLabel, hintOf } from "#shared/ui";
import { openAccountAction } from "../api/open-account-action";
import type { CountryOption } from "../lib/country-options";

const ID = "field-country";

/**
 * The step before Stripe's onboarding: the country the host's payout account is opened in.
 * Stripe fixes it when the account is opened and asks for that country's details, so the
 * host picks it here once. The combobox searches by name and the controller submits the
 * selected country's code.
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
  const selected = countries.find((country) => country.value === value) ?? null;

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
          <Combobox
            items={countries}
            value={selected}
            itemToStringLabel={(country) => country.label}
            itemToStringValue={(country) => country.value}
            onValueChange={(picked) => {
              if (picked !== null) {
                form.setValue("country", picked.value, {
                  shouldValidate: true,
                });
              }
            }}
            autoHighlight
            disabled={pending}
          >
            <ComboboxTrigger
              id={ID}
              ref={ref}
              render={<Button variant="outline" />}
              aria-invalid={fieldState.invalid}
              aria-describedby={
                [hint?.id, errorId].filter(Boolean).join(" ") || undefined
              }
              className="h-10 w-full justify-between text-base font-normal sm:max-w-sm md:text-sm"
            >
              {selected?.label ?? (
                <span className="text-muted-foreground">Choose a country</span>
              )}
            </ComboboxTrigger>
            <ComboboxContent
              aria-label="Choose a country"
              className="min-w-(--anchor-width)"
            >
              <label htmlFor={`${ID}-search`} className="sr-only">
                Search countries
              </label>
              <ComboboxInput
                id={`${ID}-search`}
                placeholder="Search countries"
                showTrigger={false}
              />
              <ComboboxEmpty>No countries found</ComboboxEmpty>
              <ComboboxList>
                {(country: CountryOption) => (
                  <ComboboxItem key={country.value} value={country}>
                    {country.label}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
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
