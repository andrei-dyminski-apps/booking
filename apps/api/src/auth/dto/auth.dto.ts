import { createZodDto } from "nestjs-zod";
import { loginSchema, registerSchema, userSchema } from "@repo/contracts";

/** Nest needs a class as the runtime metatype of the parameter — the schemas themselves live in @repo/contracts. */
export class RegisterDto extends createZodDto(registerSchema) {}

export class LoginDto extends createZodDto(loginSchema) {}

export class UserDto extends createZodDto(userSchema) {}
