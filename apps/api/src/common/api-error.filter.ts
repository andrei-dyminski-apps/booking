import { STATUS_CODES } from "node:http";
import {
  Catch,
  HttpException,
  HttpStatus,
  IntrinsicException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import {
  errorParamsSchema,
  toApiIssue,
  type ApiError,
  type ErrorCode,
} from "@repo/contracts";
import type { Response } from "express";
import { ZodValidationException } from "nestjs-zod";
import { z } from "zod";

/** The code of an answer nobody gave one of its own, one per status. */
const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: "BAD_REQUEST",
  [HttpStatus.UNAUTHORIZED]: "UNAUTHORIZED",
  [HttpStatus.FORBIDDEN]: "FORBIDDEN",
  [HttpStatus.NOT_FOUND]: "NOT_FOUND",
  [HttpStatus.METHOD_NOT_ALLOWED]: "METHOD_NOT_ALLOWED",
  [HttpStatus.CONFLICT]: "CONFLICT",
  [HttpStatus.PRECONDITION_FAILED]: "PRECONDITION_FAILED",
  [HttpStatus.PAYLOAD_TOO_LARGE]: "PAYLOAD_TOO_LARGE",
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: "UNSUPPORTED_MEDIA_TYPE",
  [HttpStatus.UNPROCESSABLE_ENTITY]: "UNPROCESSABLE_ENTITY",
  [HttpStatus.TOO_MANY_REQUESTS]: "TOO_MANY_REQUESTS",
  [HttpStatus.INTERNAL_SERVER_ERROR]: "INTERNAL_ERROR",
  [HttpStatus.BAD_GATEWAY]: "BAD_GATEWAY",
  [HttpStatus.SERVICE_UNAVAILABLE]: "SERVICE_UNAVAILABLE",
  [HttpStatus.GATEWAY_TIMEOUT]: "GATEWAY_TIMEOUT",
};

function fallbackCode(status: number): ErrorCode {
  return CODE_BY_STATUS[status] ?? "UNKNOWN_ERROR";
}

/**
 * What an `HttpException` carries as its response: a bare string, or the object Nest
 * built from one (`{ statusCode, message, error }`) with whatever `apiException` added.
 * `message` can be an array when a class-validator pipe raised it — this repository has
 * none, but the answer should still be a string if one ever appears.
 */
const responseSchema = z.object({
  message: z.union([z.string(), z.array(z.string())]).optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  params: errorParamsSchema.optional(),
});

/**
 * What of a `ZodError` the answer needs. Loose, because `toApiIssue` reads the `rule`
 * stamp off the same object and a strict parse would strip it.
 */
const zodErrorSchema = z.object({
  issues: z.array(
    z.looseObject({
      path: z.array(z.union([z.string(), z.number(), z.symbol()])),
      message: z.string(),
    }),
  ),
});

/**
 * The answer an exception turns into: always the `ApiError` of `@repo/contracts`, and so
 * always with a `code`. Separate from the filter so the shape is a function of the
 * exception and nothing else, which is how it is tested.
 */
export function toApiError(exception: HttpException): ApiError {
  const status = exception.getStatus();

  if (exception instanceof ZodValidationException) {
    const issues = zodErrorSchema.safeParse(exception.getZodError());

    return {
      statusCode: status,
      message: "Validation failed",
      error: "Bad Request",
      code: "VALIDATION_FAILED",
      errors: issues.success ? issues.data.issues.map(toApiIssue) : [],
    };
  }

  const response = exception.getResponse();
  const body = responseSchema.safeParse(
    typeof response === "string" ? { message: response } : response,
  );
  const { message, error, code, params } = body.success ? body.data : {};

  return {
    statusCode: status,
    message: Array.isArray(message)
      ? message.join("; ")
      : (message ?? exception.message),
    ...(error === undefined ? {} : { error }),
    code: code ?? fallbackCode(status),
    ...(params === undefined ? {} : { params }),
  };
}

/**
 * An error from the `http-errors` family — what the body parsers throw for malformed JSON
 * (400) or a body over the limit (413) — which is not an `HttpException` but carries the
 * status the answer should have. `expose: false` is the library saying the message is not
 * for the client (every 5xx), which is the same call Nest's own filter makes.
 */
const httpErrorSchema = z.object({
  statusCode: z.int().min(400).max(599),
  message: z.string().min(1),
  expose: z.boolean().optional(),
});

const UNEXPECTED_MESSAGE = "Internal server error";

const FIRST_SERVER_ERROR = 500;

/**
 * The answer any thrown value turns into, so that `code` is on every non-2xx body the API
 * writes: an `HttpException` as `toApiError` has it, an `http-errors` error under the
 * code of its status, and anything else — a bug — as a bare `INTERNAL_ERROR` that says
 * nothing about what broke.
 */
export function toApiErrorOf(exception: unknown): ApiError {
  if (exception instanceof HttpException) return toApiError(exception);

  const httpError = httpErrorSchema.safeParse(exception);

  if (!httpError.success) {
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: UNEXPECTED_MESSAGE,
      error: STATUS_CODES[HttpStatus.INTERNAL_SERVER_ERROR] ?? "",
      code: "INTERNAL_ERROR",
    };
  }

  const { statusCode, message, expose } = httpError.data;
  const label = STATUS_CODES[statusCode];

  return {
    statusCode,
    message: expose === false ? (label ?? UNEXPECTED_MESSAGE) : message,
    ...(label === undefined ? {} : { error: label }),
    code: fallbackCode(statusCode),
  };
}

/**
 * Writes every thrown error as an `ApiError`, which Nest's default filter does not: it
 * passes an `HttpException`'s response through as it was built, so an exception nobody
 * gave a code would answer without one, and it answers a body parser's refusal or a bug
 * with a body of its own that has none either. Registered once for the whole API as
 * `APP_FILTER`.
 *
 * Replacing Nest's filter also takes over its one other job, which is logging what is not
 * the client's fault: an unexpected error is logged with its stack, under the context
 * Nest's own filter used, and a 4xx is not logged at all, as before. An
 * `HttpException` was never logged by Nest and still is not.
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionsHandler");

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = toApiErrorOf(exception);

    if (
      !(exception instanceof HttpException) &&
      body.statusCode >= FIRST_SERVER_ERROR &&
      !(exception instanceof IntrinsicException)
    ) {
      this.logger.error(exception);
    }

    // A stream that failed after it began (the event stream) has sent its status already.
    if (response.headersSent) {
      response.end();
      return;
    }

    response.status(body.statusCode).json(body);
  }
}
