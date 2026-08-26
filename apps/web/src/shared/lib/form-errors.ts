import { ApiResponseError, ApiUnreachableError } from "../api";

/** The messages to show under each field, keyed by the name of the field. */
export type FieldErrors = Record<string, string[]>;

/** What a submitted form has to say back: one message for the form, plus the fields. */
export type FormErrors = {
  message: string | null;
  fields: FieldErrors;
};

export const NO_FORM_ERRORS: FormErrors = { message: null, fields: {} };

/**
 * The browser and the API refuse a body with the same schema, so both refusals arrive as
 * the same list of zod issues and reduce to one shape here — the first element of `path`
 * is the field the message belongs under, and an issue about the object as a whole (an
 * empty path) has no field to sit next to.
 */
export function toFieldErrors(
  issues: Iterable<{ path: readonly PropertyKey[]; message: string }>,
): FieldErrors {
  const fields: FieldErrors = {};

  for (const issue of issues) {
    const [field] = issue.path;

    if (typeof field !== "string") continue;

    (fields[field] ??= []).push(issue.message);
  }

  return fields;
}

/**
 * Only the two errors the transport promises are turned into something a form can show.
 * Anything else — a `ZodError` above all — means the answer no longer matches the
 * contract, and that has to reach the console instead of the user.
 */
export function toFormErrors(error: unknown): FormErrors {
  if (error instanceof ApiResponseError) {
    return { message: error.message, fields: toFieldErrors(error.issues) };
  }

  if (error instanceof ApiUnreachableError) {
    return {
      message: "The service is unavailable. Please try again in a moment.",
      fields: {},
    };
  }

  throw error;
}
