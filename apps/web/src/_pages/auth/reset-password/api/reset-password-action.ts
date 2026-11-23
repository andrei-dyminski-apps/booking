"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { resetPasswordSchema, type ResetPasswordInput } from "@repo/contracts";
import { authApi } from "#shared/api";
import { ROUTES } from "#shared/config";
import { toFieldErrors, toFormErrors, type FormErrors } from "#shared/lib";

export async function resetPasswordAction(
  values: ResetPasswordInput,
): Promise<FormErrors> {
  const parsed = resetPasswordSchema.safeParse(values);
  if (!parsed.success) {
    return {
      message: parsed.error.issues.some((issue) => issue.path[0] === "token")
        ? "This link is invalid or expired."
        : null,
      fields: toFieldErrors(parsed.error.issues),
    };
  }
  try {
    await authApi.resetPassword(parsed.data);
  } catch (error) {
    return toFormErrors(error);
  }

  refresh();
  redirect(ROUTES.login + "?passwordReset=1");
}
