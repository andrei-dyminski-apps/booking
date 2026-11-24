import { apiErrorSchema, toErrorCode, type ErrorCode } from "@repo/contracts";

type Answer = { body: unknown };

/** An `.expect(...)` that the refusal answered with this code. */
export const hasCode =
  (code: ErrorCode) =>
  (response: Answer): void => {
    expect(apiErrorSchema.parse(response.body).code).toBe(code);
  };

/** The rule behind each issue of a body the contract refused, in the order they were found. */
export const issueCodesOf = (response: Answer): ErrorCode[] =>
  (apiErrorSchema.parse(response.body).errors ?? []).map(({ code }) =>
    toErrorCode(code),
  );
