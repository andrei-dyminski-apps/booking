"use server";

import { redirect } from "next/navigation";
import {
  startConversationSchema,
  type StartConversationInput,
} from "@repo/contracts";
import { conversationsApi } from "#shared/api";
import { ROUTES } from "#shared/config";
import { toFieldErrors, toFormErrors, type FormErrors } from "#shared/lib";

/**
 * A guest's first message about a listing. The listing is bound by the page and overwrites
 * whatever arrives, the way `createBookingAction` binds it. Writing about a listing twice
 * is not a mistake to refuse: the API continues the thread the guest already has, and the
 * answer is that thread either way — which is where its author is sent.
 */
export async function startConversationAction(
  listingId: string,
  _state: FormErrors,
  values: StartConversationInput,
): Promise<FormErrors> {
  const parsed = startConversationSchema.safeParse({ ...values, listingId });

  if (!parsed.success) {
    return { message: null, fields: toFieldErrors(parsed.error.issues) };
  }

  let conversationId: string;

  try {
    conversationId = (await conversationsApi.start(parsed.data)).id;
  } catch (error) {
    return toFormErrors(error);
  }

  // Nothing cached changed: every read of a thread is `no-store`, and the navigation below
  // renders the thread fresh.
  redirect(ROUTES.conversation(conversationId));
}
