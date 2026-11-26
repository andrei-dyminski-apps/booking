"use server";

import { authApi, currentUser } from "#shared/api";
import { toFormErrors } from "#shared/lib";

export async function requestPasswordChangeAction(): Promise<string | null> {
  try {
    const user = await currentUser();
    if (user === null) return "Sign in again to request a password reset link.";

    await authApi.requestPasswordReset(user.email);
    return null;
  } catch (error) {
    const { message, fields } = toFormErrors(error);
    // The dialog has no email box, so a refusal of the address is the dialog's own message.
    return fields.email?.[0] ?? message ?? "Could not request a reset link.";
  }
}
