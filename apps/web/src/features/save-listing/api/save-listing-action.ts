"use server";

import { refresh, revalidateTag, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { createListingSchema } from "@repo/contracts";
import { listingsApi } from "#shared/api";
import { CATALOGUE_TAG, listingTag, ROUTES } from "#shared/config";
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

  // The author's own tag first, everybody else's second, which is the order every write
  // here uses. The row this author has just edited is the one they are about to be sent
  // to a screen that reads, and being shown their own change a beat late reads as a lost
  // save — so that read waits for a fresh answer. Every page of the catalogue now
  // describes something that is no longer true as well, and the rest of the site can be
  // shown the previous answer while a new one is fetched behind it: that is `"max"`.
  //
  // A listing that has just been created has no tag to update — nothing has read it yet,
  // and the id it would be spelled with is the one this answer only just handed back.
  if (listingId !== null) updateTag(listingTag(listingId));

  revalidateTag(CATALOGUE_TAG, "max");

  // The dashboard reads the listings with `no-store`, so nothing is cached on the server;
  // what this clears is the client's router cache, which would otherwise show the visitor
  // the list as it was before they changed it.
  refresh();
  redirect(ROUTES.dashboard);
}

/**
 * A form sends every field as text, and the contract wants two numbers — a price to the
 * cent and a whole capacity. An empty box is not a zero: handing the schema `undefined`
 * makes it say the field is missing, which is what happened, instead of refusing a number
 * nobody typed.
 */
function toNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;

  return Number(value);
}
