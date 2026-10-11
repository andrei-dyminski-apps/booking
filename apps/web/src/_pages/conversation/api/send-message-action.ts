"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { sendMessageSchema, type SendMessageInput } from "@repo/contracts";
import { conversationsApi } from "#shared/api";
import { ROUTES } from "#shared/config";
import { toFieldErrors, toFormErrors, type FormErrors } from "#shared/lib";

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
  // the router cache of the browser that sent it. The redirect lands on the newest page,
  // where the message just written is — a reply sent from an earlier page included.
  refresh();
  redirect(ROUTES.conversation(conversationId));
}
