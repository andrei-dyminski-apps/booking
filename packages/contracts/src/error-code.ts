import { z } from "zod";

/**
 * Every code the API can put in a refusal, as one list both sides read: an exception or a
 * schema rule names one of these or does not compile, so a code a client has never heard
 * of cannot reach the wire from this repository.
 *
 * A code names the *rule* that refused, not the status — `409` is what the transport says,
 * `BOOKING_NOT_PENDING` is what happened. It is stable: the sentence next to it may be
 * reworded, the code may not, because a client that words a refusal itself keys on it.
 *
 * The first group answers an exception nobody gave a code of its own (Nest's 404 for an
 * unknown route, the limiter's 429, a body the parser refused, an unexpected 500), one per
 * status, so that `code` is present on every answer. The rest is grouped by the slice of the API that raises it.
 */
export const ERROR_CODES = [
  // By status: what an exception without a code of its own answers with.
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "METHOD_NOT_ALLOWED",
  "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "UNPROCESSABLE_ENTITY",
  "TOO_MANY_REQUESTS",
  "INTERNAL_ERROR",
  "BAD_GATEWAY",
  "SERVICE_UNAVAILABLE",
  "GATEWAY_TIMEOUT",
  // A status the list above has no word for: honest about not knowing, where a guess
  // (`BAD_REQUEST` for a 402) would name a rule that never refused.
  "UNKNOWN_ERROR",

  // Validation: the body as a whole, and an issue no rule of ours claimed (zod's own
  // "expected string, received undefined").
  "VALIDATION_FAILED",
  "INVALID_INPUT",
  // The `:id` of a path is not a UUID — one code for every resource that has one.
  "INVALID_ID",

  // Session and roles.
  "AUTHENTICATION_REQUIRED",
  "SESSION_NOT_FOUND",
  "ROLE_NOT_ALLOWED",
  "NOT_AN_ADMIN_ANYMORE",

  // Auth.
  "EMAIL_ALREADY_REGISTERED",
  "INVALID_CREDENTIALS",
  "ACCOUNT_BLOCKED",
  "REFRESH_TOKEN_MISSING",
  "REFRESH_TOKEN_INVALID",
  "REFRESH_TOKEN_UNKNOWN",
  "REFRESH_TOKEN_REUSED",

  // Auth schema rules.
  "EMAIL_INVALID",
  "EMAIL_TOO_LONG",
  "PASSWORD_TOO_SHORT",
  "PASSWORD_TOO_LONG",
  "PASSWORD_REQUIRED",
  "PASSWORDS_DO_NOT_MATCH",
  "NAME_REQUIRED",
  "NAME_TOO_LONG",
  "NAME_NEEDS_LETTER",

  // Paging, shared by every keyset-paged read.
  "CURSOR_MALFORMED",
  "CURSOR_ORDERING_MISMATCH",

  // Listings.
  "LISTING_NOT_FOUND",
  "LISTING_NOT_OWNED",
  "RATE_UNDER_NON_REFUNDABLE_POLICY",

  // Listing schema rules. A price is the same rule on the default, a weekday and a date.
  "TITLE_TOO_SHORT",
  "TITLE_TOO_LONG",
  "DESCRIPTION_TOO_SHORT",
  "DESCRIPTION_TOO_LONG",
  "PRICE_REQUIRED",
  "PRICE_NOT_A_NUMBER",
  "PRICE_NOT_POSITIVE",
  "PRICE_TOO_HIGH",
  "PRICE_NOT_WHOLE_CENTS",
  "CAPACITY_REQUIRED",
  "CAPACITY_NOT_A_WHOLE_NUMBER",
  "CAPACITY_TOO_SMALL",
  "CAPACITY_TOO_LARGE",
  "DISCOUNT_OUT_OF_RANGE",
  "TIME_ZONE_REQUIRED",
  "TIME_ZONE_INVALID",
  "CHECK_IN_TIME_REQUIRED",
  "CHECK_IN_TIME_INVALID",
  "WEEKDAY_INVALID",
  "DATE_REQUIRED",
  "DATE_INVALID",
  "DATE_PRICE_IN_PAST",
  "DATE_PRICES_TOO_MANY",
  "DATE_PRICE_DUPLICATED",
  "NO_FIELDS_PROVIDED",

  // Listing query rules.
  "SEARCH_DATES_INCOMPLETE",
  "CHECK_OUT_NOT_AFTER_CHECK_IN",
  "PRICE_RANGE_INVERTED",
  "WINDOW_END_NOT_AFTER_START",
  "WINDOW_TOO_WIDE",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * A code read off the wire, as one this list holds. The schemas of an answer keep `code` a
 * plain string so a client built before the API grew a rule still reads the answer; a client
 * that branches on a code wants the narrow type instead, and a code it has no word for is
 * `UNKNOWN_ERROR` — the same "honest about not knowing" the API itself answers with — so the
 * branch falls to its `message` rather than to a guess.
 */
export function toErrorCode(code: string): ErrorCode {
  const known = errorCodeSchema.safeParse(code);

  return known.success ? known.data : "UNKNOWN_ERROR";
}

/**
 * The numbers a rule already knows when it refuses — a minimum, a ceiling, a date, the
 * roles it wanted — so a client can say them in its own words instead of reading them out
 * of a sentence. A list is a list: `["ADMIN", "USER"]`, not a string to split.
 *
 * A count needs no unit — `minimum`/`maximum` of a title are characters, of a capacity
 * guests, of a window nights, and the code says which. A quantity with a unit a client
 * could mistake carries it in the name instead: `maximumCents`, `minimumBps`. Names are as
 * permanent as codes, so a unit is written in before the first client reads one.
 */
const errorParamValueSchema = z.union([z.string(), z.number()]);

export const errorParamsSchema = z.record(
  z.string(),
  z.union([errorParamValueSchema, z.array(errorParamValueSchema)]),
);

export type ErrorParams = z.infer<typeof errorParamsSchema>;

/** What a rule leaves on the raw zod issue: the code, and the numbers behind it. */
const ruleStampSchema = z.object({
  rule: z.object({
    code: errorCodeSchema,
    params: errorParamsSchema.optional(),
  }),
});

/**
 * The `error` of a zod rule that names its code:
 *
 * ```ts
 * z.string().min(8, { error: rule("PASSWORD_TOO_SHORT", "Password must be at least 8 characters long") })
 * ```
 *
 * It answers with the sentence, as a plain string `error` would, and stamps the code and
 * the params onto the issue it is called with. zod copies every own key of a raw issue
 * into the finished one — which is how `code` reaches the API's answer and a browser's own
 * parse of the same schema alike — and `error-code.spec.ts` fails if a zod upgrade stops doing
 * so. The stamp is called `rule` because `code` is already the name of zod's own
 * (`too_small`, `custom`), which a client has no use for.
 */
export function rule(
  code: ErrorCode,
  message: string,
  params?: ErrorParams,
): (issue: object) => string {
  return (issue) => {
    Object.assign(issue, { rule: { code, params } });
    return message;
  };
}

/** A finished zod issue, as far as the wire cares: where it failed, what to say, which rule. */
type ZodIssueLike = {
  path: readonly PropertyKey[];
  message: string;
};

/**
 * One zod issue as the API serialises it. An issue no `rule()` claimed keeps zod's own
 * sentence under `INVALID_INPUT`, which is the honest answer: the schema never named it.
 */
export function toApiIssue(issue: ZodIssueLike): {
  path: (string | number)[];
  message: string;
  code: ErrorCode;
  params?: ErrorParams;
} {
  const stamp = ruleStampSchema.safeParse(issue);
  const path = issue.path.map((key) =>
    typeof key === "symbol" ? String(key) : key,
  );

  if (!stamp.success) {
    return { path, message: issue.message, code: "INVALID_INPUT" };
  }

  const { code, params } = stamp.data.rule;

  return {
    path,
    message: issue.message,
    code,
    ...(params === undefined ? {} : { params }),
  };
}
