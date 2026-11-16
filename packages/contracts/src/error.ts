import { z } from "zod";
import { errorParamsSchema } from "./error-code.js";

/**
 * A single validation problem as the API serialises it — a zod issue trimmed down to
 * what a client acts on: which field failed, what to tell the user, and which rule it was.
 *
 * `code` is a plain string rather than the `ErrorCode` enum: a client built before the API
 * grew a rule must still read the answer, and a code it has no word for falls back to
 * `message`, which is why `message` never goes away.
 */
export const apiErrorIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
  code: z.string(),
  params: errorParamsSchema.optional(),
});

/**
 * The body of every non-2xx answer.
 *
 * Nest builds it in two shapes and both fit here: its own exceptions
 * (`NotFoundException`, `ConflictException`) send `{ statusCode, message, error }`,
 * while the global `ZodValidationPipe` sends `{ statusCode, message: "Validation failed",
 * errors: [...] }` — so `errors` is present exactly when the request failed the contract
 * schema, and that is the part worth showing under the form fields.
 *
 * `code` is on every answer, the whole body's and each issue's: the API's exception filter
 * puts one per status on whatever nobody gave a code of its own. It names the rule that
 * refused and stays put when `message` is reworded — see `ERROR_CODES`.
 */
export const apiErrorSchema = z.object({
  statusCode: z.int(),
  message: z.string(),
  code: z.string(),
  params: errorParamsSchema.optional(),
  error: z.string().optional(),
  errors: z.array(apiErrorIssueSchema).optional(),
});

export type ApiErrorIssue = z.infer<typeof apiErrorIssueSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
