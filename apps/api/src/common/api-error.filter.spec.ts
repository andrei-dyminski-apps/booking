import {
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type ArgumentsHost,
} from "@nestjs/common";
import { completeRegistrationSchema } from "@repo/contracts";
import { ZodValidationException } from "nestjs-zod";
import { apiException } from "./api-exception";
import { ApiErrorFilter, toApiError, toApiErrorOf } from "./api-error.filter";

describe("toApiError", () => {
  it("keeps the code an exception was given, with the body Nest would have built", () => {
    const error = toApiError(
      apiException(
        ConflictException,
        "EMAIL_ALREADY_REGISTERED",
        "Email is already registered",
      ),
    );

    expect(error).toEqual({
      statusCode: 409,
      message: "Email is already registered",
      error: "Conflict",
      code: "EMAIL_ALREADY_REGISTERED",
    });
  });

  it("carries the params of a rule beside the sentence", () => {
    const error = toApiError(
      apiException(ForbiddenException, "ROLE_NOT_ALLOWED", "Not for you", {
        roles: ["ADMIN"],
      }),
    );

    expect(error.params).toEqual({ roles: ["ADMIN"] });
  });

  it("answers an exception nobody gave a code with the code of its status", () => {
    expect(toApiError(new NotFoundException("No such route"))).toEqual({
      statusCode: 404,
      message: "No such route",
      error: "Not Found",
      code: "NOT_FOUND",
    });
  });

  it("writes the failed validation as VALIDATION_FAILED with a code on every issue", () => {
    const result = completeRegistrationSchema.safeParse({
      name: "Ann",
      token: "a".repeat(64),
      password: "short",
    });

    if (result.success) throw new Error("The body was expected to be refused");

    expect(toApiError(new ZodValidationException(result.error))).toEqual({
      statusCode: 400,
      message: "Validation failed",
      error: "Bad Request",
      code: "VALIDATION_FAILED",
      errors: [
        {
          path: ["password"],
          message: "Password must be at least 8 characters long",
          code: "PASSWORD_TOO_SHORT",
          params: { minimum: 8 },
        },
      ],
    });
  });
});

describe("toApiErrorOf", () => {
  it("answers an http-errors error, such as a body the parser refused, under the code of its status", () => {
    const refused = Object.assign(new Error("Unexpected token } in JSON"), {
      statusCode: 400,
      expose: true,
    });

    expect(toApiErrorOf(refused)).toEqual({
      statusCode: 400,
      message: "Unexpected token } in JSON",
      error: "Bad Request",
      code: "BAD_REQUEST",
    });
    expect(
      toApiErrorOf(Object.assign(new Error("too large"), { statusCode: 413 })),
    ).toMatchObject({ statusCode: 413, code: "PAYLOAD_TOO_LARGE" });
  });

  it("keeps the message of a server-side http-errors error from the client", () => {
    const failed = Object.assign(new Error("ENOENT: /srv/secret"), {
      statusCode: 500,
      expose: false,
    });

    expect(toApiErrorOf(failed)).toEqual({
      statusCode: 500,
      message: "Internal Server Error",
      error: "Internal Server Error",
      code: "INTERNAL_ERROR",
    });
  });

  it("answers anything else as a bare 500 that says nothing of what broke", () => {
    for (const bug of [new TypeError("x is undefined"), "boom", null]) {
      expect(toApiErrorOf(bug)).toEqual({
        statusCode: 500,
        message: "Internal server error",
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
      });
    }
  });

  it("names a status the table has no word for as unknown, not as a guess", () => {
    expect(
      toApiErrorOf(Object.assign(new Error("pay up"), { statusCode: 402 })),
    ).toMatchObject({ statusCode: 402, code: "UNKNOWN_ERROR" });
    expect(
      toApiErrorOf(new HttpException("teapot", HttpStatus.I_AM_A_TEAPOT)),
    ).toMatchObject({ statusCode: 418, code: "UNKNOWN_ERROR" });
  });

  it("gives the other server statuses their own codes", () => {
    expect(toApiErrorOf(new ServiceUnavailableException("down"))).toMatchObject(
      { code: "SERVICE_UNAVAILABLE" },
    );
    expect(toApiErrorOf(new GatewayTimeoutException("slow"))).toMatchObject({
      code: "GATEWAY_TIMEOUT",
    });
  });
});

describe("ApiErrorFilter", () => {
  function hostOf(response: {
    headersSent: boolean;
    status: jest.Mock;
    json: jest.Mock;
    end: jest.Mock;
  }): ArgumentsHost {
    return {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
  }

  function responseOf() {
    const response = {
      headersSent: false,
      status: jest.fn(),
      json: jest.fn(),
      end: jest.fn(),
    };

    response.status.mockReturnValue(response);

    return response;
  }

  it("writes the body with the status and logs an unexpected error with its stack", () => {
    const filter = new ApiErrorFilter();
    const response = responseOf();
    const logged = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const bug = new TypeError("x is undefined");

    filter.catch(bug, hostOf(response));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INTERNAL_ERROR" }),
    );
    expect(logged).toHaveBeenCalledWith(bug);

    logged.mockRestore();
  });

  it("does not log a refusal, whether Nest's own or a parser's", () => {
    const filter = new ApiErrorFilter();
    const logged = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);

    filter.catch(new NotFoundException("nope"), hostOf(responseOf()));
    filter.catch(
      Object.assign(new Error("bad json"), { statusCode: 400 }),
      hostOf(responseOf()),
    );

    expect(logged).not.toHaveBeenCalled();

    logged.mockRestore();
  });

  it("ends a response whose status was already sent instead of writing a second one", () => {
    const filter = new ApiErrorFilter();
    const response = { ...responseOf(), headersSent: true };

    filter.catch(new NotFoundException("late"), hostOf(response));

    expect(response.end).toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });
});
