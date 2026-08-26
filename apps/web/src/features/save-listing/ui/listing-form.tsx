"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
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
import { NO_FORM_ERRORS, type FormErrors } from "#shared/lib";
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
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            aria-invalid={errors.fields.title !== undefined}
            disabled={pending}
          />
          <FieldError
            errors={errors.fields.title?.map((message) => ({ message }))}
          />
        </Field>

        <Field data-invalid={errors.fields.description !== undefined}>
          <FieldLabel htmlFor="description">Description</FieldLabel>
          <Textarea
            id="description"
            name="description"
            rows={4}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
            aria-invalid={errors.fields.description !== undefined}
            disabled={pending}
          />
          <FieldError
            errors={errors.fields.description?.map((message) => ({ message }))}
          />
        </Field>

        <Field data-invalid={errors.fields.pricePerNight !== undefined}>
          <FieldLabel htmlFor="pricePerNight">Price per night</FieldLabel>
          <Input
            id="pricePerNight"
            name="pricePerNight"
            type="number"
            inputMode="numeric"
            value={pricePerNight}
            onChange={(event) => {
              setPricePerNight(event.target.value);
            }}
            aria-invalid={errors.fields.pricePerNight !== undefined}
            disabled={pending}
          />
          {/*
            The column stores minor units and the payment of phase 5 will hand this value
            straight to Stripe, so the box takes what is stored rather than a price that
            has to be converted twice on its way there.
          */}
          <FieldDescription>
            In minor units: 12000 is 120.00 a night.
          </FieldDescription>
          <FieldError
            errors={errors.fields.pricePerNight?.map((message) => ({
              message,
            }))}
          />
        </Field>

        <Field data-invalid={errors.fields.capacity !== undefined}>
          <FieldLabel htmlFor="capacity">Capacity</FieldLabel>
          <Input
            id="capacity"
            name="capacity"
            type="number"
            inputMode="numeric"
            value={capacity}
            onChange={(event) => {
              setCapacity(event.target.value);
            }}
            aria-invalid={errors.fields.capacity !== undefined}
            disabled={pending}
          />
          <FieldDescription>How many guests it sleeps.</FieldDescription>
          <FieldError
            errors={errors.fields.capacity?.map((message) => ({ message }))}
          />
        </Field>

        {errors.message !== null && <FieldError>{errors.message}</FieldError>}

        <div className="flex items-center gap-2">
          <Button type="submit" size="lg" loading={pending}>
            {listing === undefined ? "Create listing" : "Save changes"}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            render={<Link href={ROUTES.dashboard} />}
          >
            Cancel
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
};
