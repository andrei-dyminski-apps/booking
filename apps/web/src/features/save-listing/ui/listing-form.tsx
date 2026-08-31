"use client";

import { useActionState, useState } from "react";
import type { Listing } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { ROUTES } from "#shared/config";
import { fieldMessages, NO_FORM_ERRORS, type FormErrors } from "#shared/lib";
import { ButtonLink } from "#shared/ui";
import { saveListingAction } from "../api/save-listing-action";

/**
 * The one form two screens run: `listing` is what tells them apart, and it is also the id
 * the action is bound to. A page that passes none is creating a listing.
 */
export const ListingForm = ({ listing }: { listing?: Listing }) => {
  const [errors, submit, pending] = useActionState<FormErrors, FormData>(
    saveListingAction.bind(null, listing?.id ?? null),
    NO_FORM_ERRORS,
  );
  // Controlled for the same reason the session forms are: React resets an uncontrolled
  // form once an action settles, which would empty every box at the moment the message
  // explaining what was wrong with one of them appears.
  const [title, setTitle] = useState(listing?.title ?? "");
  const [description, setDescription] = useState(listing?.description ?? "");
  const [pricePerNight, setPricePerNight] = useState(
    listing === undefined ? "" : String(listing.pricePerNight),
  );
  const [capacity, setCapacity] = useState(
    listing === undefined ? "" : String(listing.capacity),
  );

  return (
    // The browser's own validation would preempt the contract with messages of its own.
    <form action={submit} noValidate>
      <FieldGroup>
        <Field data-invalid={errors.fields.title !== undefined}>
          <FieldLabel htmlFor="title">Title</FieldLabel>
          <Input
            id="title"
            name="title"
            size="lg"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            aria-invalid={errors.fields.title !== undefined}
            disabled={pending}
          />
          <FieldError errors={fieldMessages(errors.fields.title)} />
        </Field>

        <Field data-invalid={errors.fields.description !== undefined}>
          <FieldLabel htmlFor="description">Description</FieldLabel>
          <Textarea
            id="description"
            name="description"
            size="lg"
            rows={4}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
            aria-invalid={errors.fields.description !== undefined}
            disabled={pending}
          />
          <FieldError errors={fieldMessages(errors.fields.description)} />
        </Field>

        <Field data-invalid={errors.fields.pricePerNight !== undefined}>
          <FieldLabel htmlFor="pricePerNight">Price per night</FieldLabel>
          <Input
            id="pricePerNight"
            name="pricePerNight"
            type="number"
            inputMode="decimal"
            // The cent is the scale the contract refuses to go finer than, so the box
            // steps in cents rather than leaving the browser to allow a third decimal the
            // action would then have to refuse.
            step="0.01"
            min="0.01"
            value={pricePerNight}
            onChange={(event) => {
              setPricePerNight(event.target.value);
            }}
            aria-invalid={errors.fields.pricePerNight !== undefined}
            disabled={pending}
          />
          <FieldDescription>
            Per night, to the cent: 120.50 is a hundred and twenty fifty.
          </FieldDescription>
          <FieldError errors={fieldMessages(errors.fields.pricePerNight)} />
        </Field>

        <Field data-invalid={errors.fields.capacity !== undefined}>
          <FieldLabel htmlFor="capacity">Capacity</FieldLabel>
          <Input
            id="capacity"
            name="capacity"
            type="number"
            size="lg"
            inputMode="numeric"
            value={capacity}
            onChange={(event) => {
              setCapacity(event.target.value);
            }}
            aria-invalid={errors.fields.capacity !== undefined}
            disabled={pending}
          />
          <FieldDescription>How many guests it sleeps.</FieldDescription>
          <FieldError errors={fieldMessages(errors.fields.capacity)} />
        </Field>

        {errors.message !== null && <FieldError>{errors.message}</FieldError>}

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
