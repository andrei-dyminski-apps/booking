import type { HttpException } from "@nestjs/common";
import type { ErrorCode, ErrorParams } from "@repo/contracts";

/** Any of Nest's `HttpException` subclasses: `ConflictException` and the rest take a message or a body. */
type ExceptionClass = new (response: string | object) => HttpException;

/**
 * An exception that carries the code of the rule that refused, beside the sentence:
 *
 * ```ts
 * throw apiException(NotFoundException, "BOOKING_NOT_FOUND", `Booking ${id} not found`);
 * ```
 *
 * The status and the `error` label stay Nest's own — the class decides them, as it always
 * did — and the answer is the body Nest would have built plus `code` and `params`, so a
 * client that knows neither reads what it read before. `params` holds what the rule knew
 * when it refused (a limit, a date) for a client that words the refusal itself; the ids and
 * the other detail that belongs in a log stay in `message`.
 */
export function apiException(
  Exception: ExceptionClass,
  code: ErrorCode,
  message: string,
  params?: ErrorParams,
): HttpException {
  // Built once with the string form to borrow the body Nest makes of it, rather than
  // copying its `{ statusCode, message, error }` here and letting the two drift.
  const body = new Exception(message).getResponse();

  return new Exception({
    ...(typeof body === "object" ? body : { message }),
    code,
    ...(params === undefined ? {} : { params }),
  });
}
