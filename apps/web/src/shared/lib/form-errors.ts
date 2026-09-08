// The type is erased at compile time, so nothing about this import reaches the bundle of
// either side: a Server Action reads `toFieldErrors` out of this same module.
import type { FieldError } from "react-hook-form";
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

/**
 * Every distinct message in `errors`, minus the fields named in `except`.
 *
 * A toolbar sits above a dialog, so a refusal of a box behind that door has to be repeated
 * out where it can be seen. A rule about a pair of fields is reported under each of them,
 * so the list is de-duplicated; `except` is for a field that has a control of its own to
 * sit under (the ordering), so its message is not shown twice.
 */
export function messagesExcept(
  errors: FieldErrors,
  ...except: string[]
): string[] {
  return [
    ...new Set(
      Object.entries(errors)
        .filter(([field]) => !except.includes(field))
        .flatMap(([, messages]) => messages),
    ),
  ];
}

/**
 * The messages of one field in the shape `FieldError` renders them. Every box of every
 * form here ends in the same line, and writing the map out at each of them is one more
 * place to hand a field the messages of its neighbour.
 *
 * `undefined` rather than an empty array is what a field with nothing wrong with it has
 * to pass on: `FieldError` renders nothing for it, and the same `undefined` is what the
 * `data-invalid` and `aria-invalid` beside it are read from.
 */
export function fieldMessages(
  messages: string[] | undefined,
): { message: string }[] | undefined {
  return messages?.map((message) => ({ message }));
}

/**
 * Every message about one box, out of the field state `react-hook-form` keeps — the third
 * source of the same shape the two above reduce to, and the one a `FormField` reads.
 *
 * Field state carries one message and, under `criteriaMode: "all"`, a `types` map of all of
 * them: a field that is both too short and in the wrong format has two things to say, and
 * so does one the API refused twice. The map is preferred where it is there and `message`
 * is the whole of it where it is not — and neither is trusted to hold text, because a rule
 * that passes no message of its own is recorded in `types` as a bare `true`.
 *
 * `undefined` rather than an empty array is what a field with nothing wrong with it has to
 * answer, for the reason `fieldMessages` above gives.
 */
export function messagesOf(
  error: FieldError | undefined,
): string[] | undefined {
  if (error === undefined) return undefined;

  const all = Object.values(error.types ?? {})
    .flat()
    .filter(isText);

  if (all.length > 0) return all;

  return isText(error.message) ? [error.message] : undefined;
}

/** A message that is actually there — a `types` entry may be a `boolean` or absent. */
function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
