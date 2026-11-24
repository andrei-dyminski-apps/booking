"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  completeRegistrationSchema,
  type CompleteRegistrationInput,
} from "@repo/contracts";
import { authApi } from "#shared/api";
import { ROUTES } from "#shared/config";
import {
  toFieldErrors,
  toFormErrors,
  toLocalPath,
  type FormErrors,
} from "#shared/lib";

export async function completeRegistrationAction(
  next: string,
  values: CompleteRegistrationInput,
): Promise<FormErrors> {
  const parsed = completeRegistrationSchema.safeParse(values);
  if (!parsed.success) {
    return {
      message: parsed.error.issues.some((issue) => issue.path[0] === "token")
        ? "This link is invalid or expired."
        : null,
      fields: toFieldErrors(parsed.error.issues),
    };
  }
  try {
    await authApi.completeRegistration(parsed.data);
  } catch (error) {
    return toFormErrors(error);
  }

  refresh();
  redirect(toLocalPath(next, ROUTES.profile));
}
