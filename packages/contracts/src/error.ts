import { z } from "zod";

/**
 * A single validation problem as the API serialises it — a zod issue trimmed down to
 * the two fields a client acts on: which field failed and what to tell the user.
 */
export const apiErrorIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

/**
 * The body of every non-2xx answer.
 *
 * Nest builds it in two shapes and both fit here: its own exceptions
 * (`NotFoundException`, `ConflictException`) send `{ statusCode, message, error }`,
 * while the global `ZodValidationPipe` sends `{ statusCode, message: "Validation failed",
 * errors: [...] }` — so `errors` is present exactly when the request failed the contract
 * schema, and that is the part worth showing under the form fields.
 */
export const apiErrorSchema = z.object({
  statusCode: z.int(),
  message: z.string(),
  error: z.string().optional(),
  errors: z.array(apiErrorIssueSchema).optional(),
});

export type ApiErrorIssue = z.infer<typeof apiErrorIssueSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
