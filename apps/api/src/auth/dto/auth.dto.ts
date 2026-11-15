import { createZodDto } from "nestjs-zod";
import { loginSchema, registerSchema, userSchema } from "@repo/contracts";
import { withExample } from "../../common/api-example";

/**
 * Nest needs a class as the runtime metatype of the parameter — the schemas themselves
 * live in @repo/contracts. A request body needs one for that reason; a response type
 * does not, because a TypeScript return type is not something Swagger can read either —
 * `UserDto` below exists only to be handed to `@ApiOkResponse`/`@ApiCreatedResponse`, the
 * controller itself keeps returning the contract type `User`.
 */
export class RegisterDto extends createZodDto(
  withExample(registerSchema, {
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "correct-horse-battery",
  }),
) {}

export class LoginDto extends createZodDto(
  // A demo login the seed writes, so "Try it out" signs in on a seeded database.
  withExample(loginSchema, {
    email: "guest@example.com",
    password: "password123",
  }),
) {}

export class UserDto extends createZodDto(userSchema) {}
