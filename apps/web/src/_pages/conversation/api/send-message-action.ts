"use server";

import { refresh } from "next/cache";
import { sendMessageSchema, type SendMessageInput } from "@repo/contracts";
import { conversationsApi } from "#shared/api";
import {
  NO_FORM_ERRORS,
  toFieldErrors,
  toFormErrors,
  type FormErrors,
} from "#shared/lib";

/**
 * One reply. The thread is bound by the page rather than taken from the payload, and
 * whether the caller may write in it is the API's to answer — a `404` for anybody who is
 * not one of its two sides, shown the way every other refusal is.
 */
export async function sendMessageAction(
  conversationId: string,
  _state: FormErrors,
  values: SendMessageInput,
): Promise<FormErrors> {
  const parsed = sendMessageSchema.safeParse(values);

  if (!parsed.success) {
    return { message: null, fields: toFieldErrors(parsed.error.issues) };
  }

  try {
    await conversationsApi.send(conversationId, parsed.data);
  } catch (error) {
    return toFormErrors(error);
  }

  // Every read of a thread is `no-store`, so there is no tag to name: what this clears is
  // the router cache of the browser that sent it. No redirect: a success is what tells the
  // form to empty itself, and a redirect would take the place of the answer that says so —
  // the form goes to the newest page itself when it was sent from an earlier one.
  refresh();

  return NO_FORM_ERRORS;
}
