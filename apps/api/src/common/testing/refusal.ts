import { HttpException } from "@nestjs/common";
import type { ApiError, ErrorParams } from "@repo/contracts";
import { toApiError } from "../api-error.filter";

function answerOf(thrown: unknown): ApiError {
  if (!(thrown instanceof HttpException)) {
    throw thrown instanceof Error
      ? thrown
      : new Error("A refusal was expected, and something else was thrown");
  }

  return toApiError(thrown);
}

/**
 * The status and the code a refused call answers with — what a client reads off the wire,
 * through the same function the filter writes it with. A spec asserts the pair rather than
 * the exception class: the class says the status, and the code is the rule.
 */
export type Refusal = {
  status: number;
  code: string;
  params?: ErrorParams;
};

function refusalFrom(answer: ApiError): Refusal {
  return {
    status: answer.statusCode,
    code: answer.code,
    ...(answer.params === undefined ? {} : { params: answer.params }),
  };
}

/** The refusal an async call rejects with. */
export async function refusalOf(call: Promise<unknown>): Promise<Refusal> {
  const answer = await call.then(
    () => {
      throw new Error("The call was expected to be refused");
    },
    (thrown: unknown) => answerOf(thrown),
  );

  return refusalFrom(answer);
}

/** The refusal a synchronous call throws (a guard). */
export function refusalOfSync(call: () => unknown): Refusal {
  try {
    call();
  } catch (thrown) {
    const answer = answerOf(thrown);

    return refusalFrom(answer);
  }

  throw new Error("The call was expected to be refused");
}
