import { ApiResponseError, refusedWith } from "#shared/api";

/**
 * The password typed to confirm the erasure is not the account's — a `403` read off its
 * code, which belongs under the box rather than over the form.
 */
export const isWrongPassword = (error: unknown): error is ApiResponseError =>
  refusedWith(error, "PASSWORD_INCORRECT");
