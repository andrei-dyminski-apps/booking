"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { createListingSchema } from "@repo/contracts";
import { listingsApi } from "#shared/api";
import { ROUTES } from "#shared/config";
import { toFieldErrors, toFormErrors, type FormErrors } from "#shared/lib";

/**
 * One action for both screens, because the form is one form: creating a listing and
 * editing one submit the same four fields, and which of the two happens is decided by
 * whether the page bound an id to it.
 *
 * `createListingSchema` validates both. The API accepts a subset for a PATCH, but this
 * form never sends one — every field is on screen with its current value, so the stricter
 * of the two schemas is also the honest one, and `updateListingSchema` would only accept
 * an emptier body than the form can produce.
 */
export async function saveListingAction(
  listingId: string | null,
  _state: FormErrors,
  formData: FormData,
): Promise<FormErrors> {
  const parsed = createListingSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    pricePerNight: toNumber(formData.get("pricePerNight")),
    capacity: toNumber(formData.get("capacity")),
  });

  if (!parsed.success) {
    return { message: null, fields: toFieldErrors(parsed.error.issues) };
  }

  try {
    if (listingId === null) {
      await listingsApi.create(parsed.data);
    } else {
      await listingsApi.update(listingId, parsed.data);
    }
  } catch (error) {
    return toFormErrors(error);
  }

  // The dashboard reads the listings with `no-store`, so nothing is cached on the server;
  // what this clears is the client's router cache, which would otherwise show the visitor
  // the list as it was before they changed it.
  refresh();
  redirect(ROUTES.dashboard);
}

/**
 * A form sends every field as text, and the contract wants two integers. An empty box is
 * not a zero: handing the schema `undefined` makes it say the field is missing, which is
 * what happened, instead of refusing a number nobody typed.
 */
function toNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;

  return Number(value);
}
