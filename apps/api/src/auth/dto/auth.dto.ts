import { createZodDto } from "nestjs-zod";
import {
  authRequestAcceptedSchema,
  completeRegistrationSchema,
  confirmEmailChangeSchema,
  loginSchema,
  registerSchema,
  requestEmailChangeSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  userSchema,
} from "@repo/contracts";
import { withExample } from "../../common/api-example";

/**
 * Nest needs a class as the runtime metatype of the parameter — the schemas themselves
 * live in @repo/contracts. A request body needs one for that reason; a response type
 * does not, because a TypeScript return type is not something Swagger can read either —
 * `UserDto` below exists only to be handed to `@ApiOkResponse`/`@ApiCreatedResponse`, the
 * controller itself keeps returning the contract type `User`.
 */
export class RegisterDto extends createZodDto(
  withExample(registerSchema, { email: "ada@example.com" }),
) {}

const exampleToken = "0".repeat(64);

export class CompleteRegistrationDto extends createZodDto(
  withExample(completeRegistrationSchema, {
    token: exampleToken,
    name: "Ada Lovelace",
    password: "correct-horse-battery",
  }),
) {}
export class RequestPasswordResetDto extends createZodDto(
  withExample(requestPasswordResetSchema, { email: "ada@mail.test" }),
) {}
export class ResetPasswordDto extends createZodDto(
  withExample(resetPasswordSchema, {
    token: exampleToken,
    password: "correct-horse-battery",
  }),
) {}
export class RequestEmailChangeDto extends createZodDto(
  withExample(requestEmailChangeSchema, {
    email: "ada@example.net",
    password: "password123",
  }),
) {}
export class ConfirmEmailChangeDto extends createZodDto(
  withExample(confirmEmailChangeSchema, { token: exampleToken }),
) {}

export class LoginDto extends createZodDto(
  // A demo login the seed writes, so "Try it out" signs in on a seeded database.
  withExample(loginSchema, {
    email: "guest@example.com",
    password: "password123",
  }),
) {}

export class UserDto extends createZodDto(userSchema) {}

export class AuthRequestAcceptedDto extends createZodDto(
  authRequestAcceptedSchema,
) {}
