"use server";

import { revalidateTag, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import {
  Role,
  deleteAccountSchema,
  openMattersParamsSchema,
  type DeleteAccountInput,
  type OpenMattersParams,
} from "@repo/contracts";
import {
  ApiResponseError,
  authApi,
  currentUser,
  listingsApi,
} from "#shared/api";
import { CATALOGUE_TAG, listingTag, ROUTES } from "#shared/config";
import { toFieldErrors, toFormErrors, type FormErrors } from "#shared/lib";
import { isWrongPassword } from "../model/delete-refusal";

/**
 * What the dialog is told back: the form's usual errors, and what is still open on the
 * account when that is why it was refused — every matter and the sides it is open on, so
 * the dialog lists them all with a link to each rather than one per attempt.
 */
export type DeleteAccountAnswer = FormErrors & {
  matters: OpenMattersParams | null;
};

/**
 * Erasing the account of the session. The password is parsed again with the schema the API
 * validates the body with — an action is an endpoint of its own — and the API's answer
 * clears the session's cookies on this origin (`authApi.deleteAccount` mirrors them). A
 * success ends in the home page's notice: nothing of the account is left to show.
 *
 * A refusal is returned rather than thrown, since what an action throws reaches the
 * browser with its message hidden: a wrong password under its box, anything else — the last
 * admin, an unreachable API — as the form's message.
 *
 * The erasure retires the account's listings the way `deleteListingAction` retires one, and
 * the cached reads that still describe them have to hear it the same way: each listing's
 * own read (`listingTag`, cached with no lifetime, so only a write naming it refreshes it)
 * and the catalogue. The API answers the erasure with nothing, so the listings are read
 * before it. An account with none on offer changes nothing either cache holds — the
 * catalogue carries no owner's name — so it revalidates nothing; a listing published in
 * another tab between the read and the erasure is a race with oneself, not worth a refetch
 * of everybody's catalogue on every erasure. Only a `USER` lists (`GET /listings/mine` is
 * theirs alone), so an admin's erasure has none to read.
 */
export async function deleteAccountAction(
  _state: FormErrors,
  values: DeleteAccountInput,
): Promise<DeleteAccountAnswer> {
  const parsed = deleteAccountSchema.safeParse(values);

  if (!parsed.success) {
    return {
      message: null,
      fields: toFieldErrors(parsed.error.issues),
      matters: null,
    };
  }

  let retired: string[];

  try {
    retired =
      (await currentUser())?.role === Role.USER
        ? (await listingsApi.mine({ cache: "no-store" })).map(
            (listing) => listing.id,
          )
        : [];
    await authApi.deleteAccount(parsed.data);
  } catch (error) {
    if (isWrongPassword(error)) {
      return {
        message: null,
        fields: { password: [error.message] },
        matters: null,
      };
    }

    return { ...toFormErrors(error), matters: openMattersOf(error) };
  }

  for (const id of retired) updateTag(listingTag(id));
  if (retired.length > 0) revalidateTag(CATALOGUE_TAG, "max");

  redirect(ROUTES.accountDeleted);
}

/** The matters a refusal named, or none — `params` is read as untrusted as the rest. */
function openMattersOf(error: unknown): OpenMattersParams | null {
  if (!(error instanceof ApiResponseError)) return null;

  const parsed = openMattersParamsSchema.safeParse(error.params);

  return parsed.success ? parsed.data : null;
}
