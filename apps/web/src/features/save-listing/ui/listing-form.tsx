"use client";

import {
  createListingSchema,
  type CreateListingInput,
  type Listing,
} from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { FieldError, FieldGroup } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { ROUTES } from "#shared/config";
import { useActionForm } from "#shared/lib";
import { ButtonLink, FormField } from "#shared/ui";
import { saveListingAction } from "../api/save-listing-action";

/**
 * The one form two screens run: `listing` is what tells them apart, and it is also the id
 * the action is bound to. A page that passes none is creating a listing.
 *
 * `createListingSchema` validates it here and again in the action, so a title of two
 * characters or a price with three decimals is refused in the box it was typed into. The
 * schema wants numbers and a box hands over text, which is what `toNumber` below is for.
 */
export const ListingForm = ({ listing }: { listing?: Listing }) => {
  const { form, submit, pending, message } = useActionForm<CreateListingInput>({
    action: saveListingAction.bind(null, listing?.id ?? null),
    schema: createListingSchema,
    defaultValues: {
      title: listing?.title ?? "",
      description: listing?.description ?? "",
      pricePerNight: listing?.pricePerNight,
      capacity: listing?.capacity,
    },
  });

  return (
    // `method` is what a page with no scripts falls back to — see `register-form.tsx`.
    // `noValidate` is the usual reason: the browser's own validation would preempt the
    // contract with messages of its own.
    <form method="post" onSubmit={submit} noValidate>
      <FieldGroup>
        <FormField
          form={form}
          name="title"
          label="Title"
          // The ceiling comes off the schema rather than being written down a second
          // time: the count and the sentence that refuses a title too long have to be
          // about the same number.
          limit={createListingSchema.shape.title.maxLength}
        >
          {(control) => <Input {...control} size="lg" disabled={pending} />}
        </FormField>

        <FormField
          form={form}
          name="description"
          label="Description"
          limit={createListingSchema.shape.description.maxLength}
        >
          {(control) => (
            <Textarea {...control} size="lg" rows={4} disabled={pending} />
          )}
        </FormField>

        <FormField
          form={form}
          name="pricePerNight"
          label="Price per night"
          description="Per night, to the cent: 120.50 is a hundred and twenty fifty."
          options={{ setValueAs: toNumber }}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              size="lg"
              inputMode="decimal"
              // The cent is the scale the contract refuses to go finer than, so the box
              // steps in cents rather than leaving the browser to allow a third decimal
              // the schema would then have to refuse.
              step="0.01"
              min="0.01"
              disabled={pending}
            />
          )}
        </FormField>

        <FormField
          form={form}
          name="capacity"
          label="Capacity"
          description="How many guests it sleeps."
          options={{ setValueAs: toNumber }}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              size="lg"
              // No `step`, which is what tells the two boxes apart: a price takes a
              // fraction and wants the keypad with a separator on it, a count does not.
              inputMode="numeric"
              min="1"
              disabled={pending}
            />
          )}
        </FormField>

        {message !== null && <FieldError>{message}</FieldError>}

        {/* Stacked and full-width on a phone, an inline row from `sm` up. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button type="submit" size="lg" loading={pending}>
            {listing === undefined ? "Create listing" : "Save changes"}
          </Button>
          <ButtonLink href={ROUTES.dashboard} variant="ghost" size="lg">
            Cancel
          </ButtonLink>
        </div>
      </FieldGroup>
    </form>
  );
};

/**
 * A box hands over text and the contract wants two numbers — a price to the cent and a
 * whole capacity. An empty box is not a zero: handing the schema `undefined` makes it say
 * the field is missing, which is what happened, instead of refusing a number nobody
 * typed. Text that is not a number at all becomes `NaN` and is refused as one.
 */
function toNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}
