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
    return toFormErrors(error).message ?? "Could not request a reset link.";
  }
}
