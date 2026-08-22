import { createZodDto } from "nestjs-zod";
import { loginSchema, registerSchema } from "@repo/contracts";

/**
 * Nest needs a class as the runtime metatype of the parameter — the schemas themselves
 * live in @repo/contracts. Only a request body needs one: a response leaves as the
 * contract type, and a class named after it would document nothing, because a TypeScript
 * return type is not something Swagger can read.
 */
export class RegisterDto extends createZodDto(registerSchema) {}

export class LoginDto extends createZodDto(loginSchema) {}
